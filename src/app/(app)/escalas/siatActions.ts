"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { fetchDrivers, fetchReservations, fetchVehicles, isSiatAvailable } from "@/lib/siat/client";
import type { SiatDriver, SiatReservation, SiatVehicle } from "@/lib/siat/types";
import { findEscalaConflicts, findInterjornadaWarnings } from "@/lib/escalaConflicts";

export type SiatSyncRowError = { context: string; message: string };
export type SiatSyncResult = {
  vehicles: { created: number; updated: number };
  drivers: { created: number; updated: number; unmatched: number };
  escalas: { created: number; updated: number };
  errors: SiatSyncRowError[];
};

function normName(s: string) {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

// Reservation.driver_name vem abreviado com frequencia (confirmado real:
// "ANTENOR", "Carlos Alberto", "Fernando Martins" — enquanto o motorista
// esta cadastrado com o nome completo, ex. "ANTENOR AMALIO DE SOUZA
// JUNIOR", "CARLOS ALBERTO DA SILVA", "FERNANDO MARTINS DOS SANTOS") —
// casamento exato por nome perde esses casos. Aqui, se o exato nao bate,
// tenta por PREFIXO (nome da reserva = inicio do nome completo, respeitando
// fronteira de palavra) — so aceita se o prefixo casar com EXATAMENTE 1
// motorista, pra nao arriscar casar com a pessoa errada quando 2+ tem o
// mesmo primeiro nome.
function findDriverByName(rawName: string, driverByName: Map<string, { id: string; name: string }>, allDrivers: { id: string; name: string }[]) {
  const target = normName(rawName);
  const exact = driverByName.get(target);
  if (exact) return exact;
  if (target.length < 4) return undefined;
  const candidates = allDrivers.filter((d) => normName(d.name).startsWith(`${target} `));
  return candidates.length === 1 ? candidates[0] : undefined;
}

// Placa brasileira, formato antigo (ABC1234) ou Mercosul (ABC1D23) —
// extrai de dentro de um texto livre tipo "177 - van - MASTER V A6 PAS -
// UPD9C09" (formato real confirmado, varia motorista a motorista).
const PLATE_PATTERN = /\b[A-Z]{3}[0-9][A-Z0-9][0-9]{2}\b/;
function extractPlate(vehicleInfo: string | null): string | null {
  if (!vehicleInfo) return null;
  const match = vehicleInfo.toUpperCase().match(PLATE_PATTERN);
  return match ? match[0] : null;
}

// Sincroniza Veiculos, Motoristas e Escalas (a partir de Reservation — ver
// comentario em src/lib/siat/types.ts sobre por que nao e ScaleAssignment)
// do SIAT, nessa ordem: Reservation resolve driverId/vehicleId locais via
// siatId preenchido nos 2 primeiros passos (com fallback por nome/placa
// quando o SIAT nao manda o id, o que acontece em boa parte dos registros
// reais).
export async function syncFromSiat(dateFrom: string, dateTo: string): Promise<SiatSyncResult> {
  const session = await requireRole("ADMIN", "GESTOR");
  const result: SiatSyncResult = {
    vehicles: { created: 0, updated: 0 },
    drivers: { created: 0, updated: 0, unmatched: 0 },
    escalas: { created: 0, updated: 0 },
    errors: [],
  };

  if (!isSiatAvailable()) {
    result.errors.push({ context: "config", message: "Integração com o SIAT não configurada (SIAT_API_KEY)." });
    return result;
  }

  // 1) Veiculos — casa por placa (ja unica aqui), cria se nao existir.
  let siatVehicles: SiatVehicle[];
  try {
    siatVehicles = await fetchVehicles();
  } catch (e) {
    result.errors.push({ context: "veículos", message: e instanceof Error ? e.message : "Falha ao buscar veículos do SIAT." });
    siatVehicles = [];
  }
  const existingVehicles = await prisma.vehicle.findMany({ where: { companyId: session.companyId } });
  const vehicleByPlate = new Map(existingVehicles.map((v) => [v.plate.trim().toUpperCase(), v]));
  const vehicleBySiatId = new Map(existingVehicles.filter((v) => v.siatId).map((v) => [v.siatId as string, v]));

  for (const sv of siatVehicles) {
    const existing = vehicleBySiatId.get(sv.id) ?? vehicleByPlate.get(sv.plate);
    const enrichment = { siatId: sv.id, color: sv.color, capacity: sv.capacity, ownership: sv.ownership, licensingMonth: sv.licensingMonth };
    if (existing) {
      const updated = await prisma.vehicle.update({ where: { id: existing.id }, data: enrichment });
      result.vehicles.updated++;
      vehicleBySiatId.set(sv.id, updated);
      vehicleByPlate.set(sv.plate, updated);
    } else {
      if (!sv.brand || !sv.model || sv.year == null || !sv.type) {
        result.errors.push({ context: `veículo ${sv.plate}`, message: "Veículo novo no SIAT sem marca/modelo/ano/tipo completos — não criado, cadastre manualmente." });
        continue;
      }
      const created = await prisma.vehicle.create({
        data: { companyId: session.companyId, plate: sv.plate, brand: sv.brand, model: sv.model, year: sv.year, type: sv.type, ...enrichment },
      });
      result.vehicles.created++;
      vehicleBySiatId.set(sv.id, created);
      vehicleByPlate.set(sv.plate, created);
    }
  }

  // 2) Motoristas — cria quando o SIAT traz CPF real (confirmado: acontece
  // em parte dos registros); quando nao traz, so enriquece um motorista ja
  // cadastrado aqui (casado por nome), nunca cria (CPF e obrigatorio e
  // unico no nosso cadastro).
  let siatDrivers: SiatDriver[];
  try {
    siatDrivers = await fetchDrivers();
  } catch (e) {
    result.errors.push({ context: "motoristas", message: e instanceof Error ? e.message : "Falha ao buscar motoristas do SIAT." });
    siatDrivers = [];
  }
  const existingDrivers = await prisma.driver.findMany({ where: { companyId: session.companyId } });
  const driverByName = new Map(existingDrivers.map((d) => [normName(d.name), d]));
  const driverByCpf = new Map(existingDrivers.map((d) => [d.cpf.replace(/\D/g, ""), d]));
  const driverBySiatId = new Map(existingDrivers.filter((d) => d.siatId).map((d) => [d.siatId as string, d]));

  for (const sd of siatDrivers) {
    const existing = driverBySiatId.get(sd.id) ?? (sd.cpf ? driverByCpf.get(sd.cpf) : undefined) ?? driverByName.get(normName(sd.name));
    const enrichment: Record<string, unknown> = { siatId: sd.id, tipoContratacaoSiat: sd.type };
    if (existing) {
      if (!existing.cnh && sd.cnhNumber) enrichment.cnh = sd.cnhNumber;
      if (!existing.cnhCategory && sd.cnhCategory) enrichment.cnhCategory = sd.cnhCategory;
      if (!existing.cnhExpiration && sd.cnhValidity) enrichment.cnhExpiration = parseLocalDate(sd.cnhValidity);
      const updated = await prisma.driver.update({ where: { id: existing.id }, data: enrichment });
      result.drivers.updated++;
      driverBySiatId.set(sd.id, updated);
      driverByCpf.set(updated.cpf.replace(/\D/g, ""), updated);
      driverByName.set(normName(updated.name), updated);
    } else if (sd.cpf) {
      const created = await prisma.driver.create({
        data: {
          companyId: session.companyId,
          name: sd.name,
          cpf: sd.cpf,
          phone: sd.phone,
          cnh: sd.cnhNumber,
          cnhCategory: sd.cnhCategory,
          cnhExpiration: sd.cnhValidity ? parseLocalDate(sd.cnhValidity) : null,
          ...enrichment,
        },
      });
      result.drivers.created++;
      driverBySiatId.set(sd.id, created);
      driverByCpf.set(sd.cpf, created);
      driverByName.set(normName(created.name), created);
    } else {
      result.drivers.unmatched++;
    }
  }

  // 3) Escalas — a partir de Reservation, fonte real da escala do dia a
  // dia (ver types.ts). SIAT e fonte oficial: sincronizacoes seguintes
  // atualizam livremente o que ja veio de la (fonte "SIAT"); um eventual
  // registro manual legado (fonte nula) nunca e sobrescrito.
  let siatReservations: SiatReservation[];
  try {
    siatReservations = await fetchReservations(dateFrom, dateTo);
  } catch (e) {
    result.errors.push({ context: "escalas", message: e instanceof Error ? e.message : "Falha ao buscar reservas do SIAT." });
    siatReservations = [];
  }
  const existingEscalas = await prisma.escala.findMany({ where: { companyId: session.companyId, siatId: { not: null } } });
  const escalaBySiatId = new Map(existingEscalas.map((e) => [e.siatId as string, e]));
  const allDriversArray = [...driverByName.values()];

  for (const sr of siatReservations) {
    const driverLocal = (sr.driverId ? driverBySiatId.get(sr.driverId) : undefined) ?? (sr.driverName ? findDriverByName(sr.driverName, driverByName, allDriversArray) : undefined);
    const plate = extractPlate(sr.vehicleInfo);
    const vehicleLocal = (sr.vehicleId ? vehicleBySiatId.get(sr.vehicleId) : undefined) ?? (plate ? vehicleByPlate.get(plate) : undefined);

    if (!driverLocal) {
      result.errors.push({ context: `reserva ${sr.reservationNumber ?? sr.id} (${sr.date})`, message: sr.driverName ? `Motorista "${sr.driverName}" não encontrado no cadastro.` : "Sem motorista atribuído no SIAT ainda." });
      continue;
    }
    if (!vehicleLocal) {
      result.errors.push({ context: `reserva ${sr.reservationNumber ?? sr.id} (${sr.date})`, message: sr.vehicleInfo ? `Veículo "${sr.vehicleInfo}" não encontrado no cadastro.` : "Sem veículo atribuído no SIAT ainda." });
      continue;
    }

    // sr.endTime vem nulo em boa parte das reservas reais (SIAT nao
    // preenche trip_end_time) — cria a escala so com o inicio em vez de
    // descartar um turno de verdade (ver comentario no schema).
    const data = {
      driverId: driverLocal.id,
      vehicleId: vehicleLocal.id,
      date: parseLocalDate(sr.date),
      startTime: sr.time,
      endTime: sr.endTime,
      siatId: sr.id,
      fonte: "SIAT",
      scaleName: sr.reservationNumber,
      routeName: sr.routeName,
      clientName: sr.clientName,
      boardingAddress: sr.boardingAddress,
      dropoffAddress: sr.dropoffAddress,
      status: sr.status,
    };

    const existing = escalaBySiatId.get(sr.id);
    if (existing && existing.fonte !== "SIAT") {
      result.errors.push({ context: `reserva ${sr.reservationNumber ?? sr.id} (${sr.date})`, message: "Já existe registro local não sincronizado com este mesmo siatId — não sobrescrito." });
      continue;
    }

    // Sem horario de fim nao da pra checar sobreposicao/descanso desse
    // turno especifico (ver guards em escalaConflicts.ts pro lado inverso —
    // essa escala tambem nao entra na checagem de outras).
    if (data.endTime) {
      const conflicts = await findEscalaConflicts({ companyId: session.companyId, driverId: data.driverId, vehicleId: data.vehicleId, date: data.date, startTime: data.startTime, endTime: data.endTime, excludeId: existing?.id });
      if (conflicts.length > 0) {
        result.errors.push({ context: `reserva ${sr.reservationNumber ?? sr.id} (${sr.date})`, message: `Aviso: conflito de horário — ${conflicts.map((c) => `${c.type} (${c.startTime}–${c.endTime})`).join(", ")}.` });
      }
      const interjornada = await findInterjornadaWarnings({ companyId: session.companyId, driverId: data.driverId, date: data.date, startTime: data.startTime, endTime: data.endTime, excludeId: existing?.id });
      if (interjornada.length > 0) {
        result.errors.push({ context: `reserva ${sr.reservationNumber ?? sr.id} (${sr.date})`, message: "Aviso: descanso insuficiente entre turnos do motorista." });
      }
    }

    if (existing) {
      await prisma.escala.update({ where: { id: existing.id }, data });
      result.escalas.updated++;
    } else {
      await prisma.escala.create({ data: { ...data, companyId: session.companyId } });
      result.escalas.created++;
    }
  }

  revalidatePath("/escalas");
  return result;
}
