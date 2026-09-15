// Nucleo da sincronizacao SIAT, sem sessao — usado pela server action
// (escalas/siatActions.ts) e pelo cron. Fica fora de arquivo "use server"
// de proposito: la todo export vira endpoint publico de Server Action.
import { addDays, format } from "date-fns";
import type { Driver, Escala, Prisma, Vehicle } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseLocalDate, utcInstantToLocalParts } from "@/lib/date";
import { fetchDrivers, fetchReservations, fetchScaleAssignments, fetchVehicles, isSiatAvailable } from "@/lib/siat/client";
import type { SiatDriver, SiatReservation, SiatScaleAssignment, SiatVehicle } from "@/lib/siat/types";
import {
  calcularConflitosEscala,
  calcularInterjornada,
  janelaInterjornada,
  type EscalaParaChecagem,
  type MotoristaParaInterjornada,
} from "@/lib/escalaConflicts";
import { extractPlate } from "@/lib/plate";

export type SiatSyncRowError = { context: string; message: string };
export type SiatSyncResult = {
  // updated = registros que de fato mudaram; unchanged = ja estavam iguais
  // (nao sao regravados).
  vehicles: { created: number; updated: number; unchanged: number };
  drivers: { created: number; updated: number; unchanged: number; unmatched: number };
  escalas: { created: number; updated: number; unchanged: number };
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
function findDriverByName<D extends { id: string; name: string }>(rawName: string, driverByName: Map<string, D>, allDrivers: D[]): D | undefined {
  const target = normName(rawName);
  const exact = driverByName.get(target);
  if (exact) return exact;
  if (target.length < 4) return undefined;
  const candidates = allDrivers.filter((d) => normName(d.name).startsWith(`${target} `));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function lotes<T>(itens: T[], tamanho: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}

const igual = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const normalizar = (v: unknown) => (v instanceof Date ? v.getTime() : (v ?? null));

type DadosEscala = Omit<Prisma.EscalaUncheckedCreateInput, "companyId" | "driverId" | "vehicleId" | "date" | "startTime" | "endTime" | "siatId"> & {
  driverId: string;
  vehicleId: string | null;
  date: Date;
  startTime: string;
  endTime: string | null;
  siatId: string;
};

function escalaMudou(existente: Escala, data: DadosEscala): boolean {
  const atual = existente as unknown as Record<string, unknown>;
  return Object.entries(data).some(([campo, valor]) => normalizar(atual[campo]) !== normalizar(valor));
}

// Escalas vizinhas em memoria, indexadas por dia — alimenta as checagens de
// conflito e interjornada sem ir ao banco por reserva, e e atualizado a cada
// escala criada/alterada no lote (a checagem da reserva seguinte enxerga a
// anterior, como acontecia quando cada checagem consultava o banco).
class IndiceEscalas {
  private porDia = new Map<string, Map<string, EscalaParaChecagem>>();
  private diaPorId = new Map<string, string>();

  set(e: EscalaParaChecagem) {
    const dia = format(e.date, "yyyy-MM-dd");
    const anterior = this.diaPorId.get(e.id);
    if (anterior && anterior !== dia) this.porDia.get(anterior)?.delete(e.id);
    let doDia = this.porDia.get(dia);
    if (!doDia) {
      doDia = new Map();
      this.porDia.set(dia, doDia);
    }
    doDia.set(e.id, e);
    this.diaPorId.set(e.id, dia);
  }

  entre(inicio: Date, fimExclusivo: Date): EscalaParaChecagem[] {
    const out: EscalaParaChecagem[] = [];
    for (let d = new Date(inicio); d < fimExclusivo; d = addDays(d, 1)) {
      const doDia = this.porDia.get(format(d, "yyyy-MM-dd"));
      if (doDia) out.push(...doDia.values());
    }
    return out;
  }
}

// Sincroniza Veiculos, Motoristas e Escalas (a partir de Reservation — ver
// comentario em src/lib/siat/types.ts sobre por que nao e ScaleAssignment)
// do SIAT, nessa ordem: Reservation resolve driverId/vehicleId locais via
// siatId preenchido nos 2 primeiros passos (com fallback por nome/placa
// quando o SIAT nao manda o id, o que acontece em boa parte dos registros
// reais). Nucleo sem sessao — usado tanto pela server action (usuario
// logado) quanto pelo cron diario (sem sessao, ver cron/siat-import).
//
// Consultas ao banco em lote: cadastro e escalas vizinhas carregados uma vez,
// checagens de conflito/interjornada em memoria e gravacao so do que mudou.
// Antes eram ~5 consultas por reserva e um update por veiculo/motorista
// mesmo sem mudanca nenhuma.
export async function syncFromSiatCore(companyId: string, dateFrom: string, dateTo: string): Promise<SiatSyncResult> {
  const result: SiatSyncResult = {
    vehicles: { created: 0, updated: 0, unchanged: 0 },
    drivers: { created: 0, updated: 0, unchanged: 0, unmatched: 0 },
    escalas: { created: 0, updated: 0, unchanged: 0 },
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
  const existingVehicles = await prisma.vehicle.findMany({ where: { companyId } });
  const vehicleByPlate = new Map<string, Vehicle>(existingVehicles.map((v) => [v.plate.trim().toUpperCase(), v]));
  const vehicleBySiatId = new Map<string, Vehicle>(existingVehicles.filter((v) => v.siatId).map((v) => [v.siatId as string, v]));

  for (const sv of siatVehicles) {
    const existing = vehicleBySiatId.get(sv.id) ?? vehicleByPlate.get(sv.plate);
    const enrichment = { siatId: sv.id, color: sv.color, capacity: sv.capacity, ownership: sv.ownership, licensingMonth: sv.licensingMonth };
    if (existing) {
      const semMudanca =
        igual(existing.siatId, sv.id) &&
        igual(existing.color, sv.color) &&
        igual(existing.capacity, sv.capacity) &&
        igual(existing.ownership, sv.ownership) &&
        igual(existing.licensingMonth, sv.licensingMonth);
      const atual = semMudanca ? existing : await prisma.vehicle.update({ where: { id: existing.id }, data: enrichment });
      if (semMudanca) result.vehicles.unchanged++;
      else result.vehicles.updated++;
      vehicleBySiatId.set(sv.id, atual);
      vehicleByPlate.set(sv.plate, atual);
    } else {
      if (!sv.brand || !sv.model || !sv.type) {
        result.errors.push({ context: `veículo ${sv.plate}`, message: "Veículo novo no SIAT sem marca/modelo/tipo completos — não criado, cadastre manualmente." });
        continue;
      }
      const created = await prisma.vehicle.create({
        data: { companyId, plate: sv.plate, brand: sv.brand, model: sv.model, year: sv.year, type: sv.type, ...enrichment },
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
  const existingDrivers = await prisma.driver.findMany({ where: { companyId } });
  const driverByName = new Map<string, Driver>(existingDrivers.map((d) => [normName(d.name), d]));
  const driverByCpf = new Map<string, Driver>(existingDrivers.map((d) => [d.cpf.replace(/\D/g, ""), d]));
  const driverBySiatId = new Map<string, Driver>(existingDrivers.filter((d) => d.siatId).map((d) => [d.siatId as string, d]));

  // Motorista local -> id do SIAT com que ja casou nesta rodada. O SIAT tem
  // pessoas cadastradas duas vezes (visto real: um cadastro com CPF e outro
  // sem); sem esta trava, cada cadastro regravava o siatId do mesmo motorista
  // e ele era atualizado a toda sincronizacao. O segundo id passa a apontar
  // pro mesmo motorista (as reservas dele continuam casando) e vira aviso.
  const casadoNestaRodada = new Map<string, string>();
  for (const sd of siatDrivers) {
    const existing = driverBySiatId.get(sd.id) ?? (sd.cpf ? driverByCpf.get(sd.cpf) : undefined) ?? driverByName.get(normName(sd.name));
    if (existing) {
      const jaCasado = casadoNestaRodada.get(existing.id);
      if (jaCasado && jaCasado !== sd.id) {
        driverBySiatId.set(sd.id, existing);
        result.drivers.unchanged++;
        result.errors.push({
          context: `motorista ${existing.name}`,
          message: `Cadastrado duas vezes no SIAT (ids ${jaCasado} e ${sd.id}) — unificar o cadastro no SIAT.`,
        });
        continue;
      }
      casadoNestaRodada.set(existing.id, sd.id);
    }
    const enrichment: Record<string, unknown> = { siatId: sd.id, tipoContratacaoSiat: sd.type };
    if (existing) {
      if (!existing.cnh && sd.cnhNumber) enrichment.cnh = sd.cnhNumber;
      if (!existing.cnhCategory && sd.cnhCategory) enrichment.cnhCategory = sd.cnhCategory;
      if (!existing.cnhExpiration && sd.cnhValidity) enrichment.cnhExpiration = parseLocalDate(sd.cnhValidity);
      const semMudanca = Object.keys(enrichment).length === 2 && igual(existing.siatId, sd.id) && igual(existing.tipoContratacaoSiat, sd.type);
      const atual = semMudanca ? existing : await prisma.driver.update({ where: { id: existing.id }, data: enrichment });
      if (semMudanca) result.drivers.unchanged++;
      else result.drivers.updated++;
      driverBySiatId.set(sd.id, atual);
      driverByCpf.set(atual.cpf.replace(/\D/g, ""), atual);
      driverByName.set(normName(atual.name), atual);
    } else if (sd.cpf) {
      const created = await prisma.driver.create({
        data: {
          companyId,
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
      casadoNestaRodada.set(created.id, sd.id);
      driverByCpf.set(sd.cpf, created);
      driverByName.set(normName(created.name), created);
    } else {
      result.drivers.unmatched++;
    }
  }

  // Reservas e plantoes do periodo, buscados antes de gravar qualquer escala
  // pra carregar do banco, de uma vez, so as escalas que interessam.
  let siatReservations: SiatReservation[];
  try {
    siatReservations = await fetchReservations(dateFrom, dateTo);
  } catch (e) {
    result.errors.push({ context: "escalas", message: e instanceof Error ? e.message : "Falha ao buscar reservas do SIAT." });
    siatReservations = [];
  }
  let siatScaleAssignments: SiatScaleAssignment[];
  try {
    siatScaleAssignments = await fetchScaleAssignments();
  } catch (e) {
    result.errors.push({ context: "plantões", message: e instanceof Error ? e.message : "Falha ao buscar plantões do SIAT." });
    siatScaleAssignments = [];
  }

  const rangeStart = parseLocalDate(dateFrom);
  const rangeEnd = parseLocalDate(dateTo);
  const plantoesNoPeriodo = siatScaleAssignments.flatMap((sa) => {
    const startParts = utcInstantToLocalParts(sa.startDatetime);
    if (!startParts) return [];
    const localDate = parseLocalDate(startParts.dateISO);
    if (localDate < rangeStart || localDate > rangeEnd) return []; // fora do periodo pedido
    return [{ sa, startParts, localDate }];
  });

  const escalaBySiatId = new Map<string, Escala>();
  const siatIds = [...new Set([...siatReservations.map((r) => r.id), ...plantoesNoPeriodo.map((p) => p.sa.id)])];
  for (const lote of lotes(siatIds, 1000)) {
    const rows = await prisma.escala.findMany({ where: { companyId, siatId: { in: lote } } });
    for (const r of rows) escalaBySiatId.set(r.siatId as string, r);
  }

  const janelaInicio = janelaInterjornada(rangeStart).rangeStart;
  const janelaFim = janelaInterjornada(rangeEnd).rangeEnd;
  const [vizinhas, sindicatos] = await Promise.all([
    prisma.escala.findMany({
      where: { companyId, date: { gte: janelaInicio, lt: janelaFim } },
      select: { id: true, driverId: true, vehicleId: true, date: true, startTime: true, endTime: true, driver: { select: { name: true } }, vehicle: { select: { plate: true } } },
    }),
    prisma.sindicato.findMany({ where: { companyId }, include: { convencoes: { include: { regras: true } } } }),
  ]);
  const indice = new IndiceEscalas();
  for (const e of vizinhas) {
    indice.set({ id: e.id, driverId: e.driverId, vehicleId: e.vehicleId, date: e.date, startTime: e.startTime, endTime: e.endTime, driverName: e.driver.name, vehiclePlate: e.vehicle?.plate ?? null });
  }
  const sindicatoById = new Map(sindicatos.map((s) => [s.id, s]));
  const comConvencoes = (d: Driver) =>
    ({ ...d, sindicato: d.sindicatoId ? (sindicatoById.get(d.sindicatoId) ?? null) : null }) as unknown as MotoristaParaInterjornada;
  const allDriversArray = [...driverByName.values()];

  const gravarEscala = async (contexto: string, data: DadosEscala, motorista: Driver, veiculo: Vehicle | undefined) => {
    const existing = escalaBySiatId.get(data.siatId);
    if (existing && existing.fonte !== "SIAT") {
      result.errors.push({ context: contexto, message: "Já existe registro local não sincronizado com este mesmo siatId — não sobrescrito." });
      return;
    }

    // Sem horario de fim nao da pra checar sobreposicao/descanso desse turno
    // especifico (ver guards em escalaConflicts.ts pro lado inverso — essa
    // escala tambem nao entra na checagem de outras).
    if (data.endTime) {
      const { rangeStart: ini, rangeEnd: fim } = janelaInterjornada(data.date);
      const candidatas = indice.entre(ini, fim);
      const params = { driverId: data.driverId, vehicleId: data.vehicleId, date: data.date, startTime: data.startTime, endTime: data.endTime, excludeId: existing?.id };
      const conflicts = calcularConflitosEscala(params, candidatas);
      if (conflicts.length > 0) {
        result.errors.push({ context: contexto, message: `Aviso: conflito de horário — ${conflicts.map((c) => `${c.type} (${c.startTime}–${c.endTime})`).join(", ")}.` });
      }
      if (calcularInterjornada(comConvencoes(motorista), params, candidatas).length > 0) {
        result.errors.push({ context: contexto, message: "Aviso: descanso insuficiente entre turnos do motorista." });
      }
    }

    let gravada: Escala;
    if (existing) {
      if (!escalaMudou(existing, data)) {
        result.escalas.unchanged++;
        gravada = existing;
      } else {
        gravada = await prisma.escala.update({ where: { id: existing.id }, data });
        result.escalas.updated++;
      }
    } else {
      // Atualiza o Map na hora — sem isso, a mesma reserva aparecendo 2x no
      // mesmo lote (confirmado real: SIAT as vezes devolve a mesma reserva
      // em mais de um dia) tenta criar de novo na segunda vez e quebra por
      // siatId duplicado.
      gravada = await prisma.escala.create({ data: { ...data, companyId } });
      result.escalas.created++;
    }
    escalaBySiatId.set(data.siatId, gravada);
    indice.set({
      id: gravada.id,
      driverId: gravada.driverId,
      vehicleId: gravada.vehicleId,
      date: gravada.date,
      startTime: gravada.startTime,
      endTime: gravada.endTime,
      driverName: motorista.name,
      vehiclePlate: veiculo?.plate ?? null,
    });
  };

  // 3) Escalas — a partir de Reservation, fonte real da escala do dia a dia
  // (ver types.ts). SIAT e fonte oficial: sincronizacoes seguintes atualizam
  // livremente o que ja veio de la (fonte "SIAT"); um eventual registro
  // manual legado (fonte nula) nunca e sobrescrito.
  for (const sr of siatReservations) {
    const contexto = `reserva ${sr.reservationNumber ?? sr.id} (${sr.date})`;
    const driverLocal = (sr.driverId ? driverBySiatId.get(sr.driverId) : undefined) ?? (sr.driverName ? findDriverByName(sr.driverName, driverByName, allDriversArray) : undefined);
    const plate = extractPlate(sr.vehicleInfo);
    const vehicleLocal = (sr.vehicleId ? vehicleBySiatId.get(sr.vehicleId) : undefined) ?? (plate ? vehicleByPlate.get(plate) : undefined);

    if (!driverLocal) {
      result.errors.push({ context: contexto, message: sr.driverName ? `Motorista "${sr.driverName}" não encontrado no cadastro.` : "Sem motorista atribuído no SIAT ainda." });
      continue;
    }
    if (!vehicleLocal) {
      result.errors.push({ context: contexto, message: sr.vehicleInfo ? `Veículo "${sr.vehicleInfo}" não encontrado no cadastro.` : "Sem veículo atribuído no SIAT ainda." });
      continue;
    }

    // sr.endTime vem nulo em boa parte das reservas reais (SIAT nao preenche
    // trip_end_time) — cria a escala so com o inicio em vez de descartar um
    // turno de verdade (ver comentario no schema).
    await gravarEscala(
      contexto,
      {
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
        requestType: sr.requestType,
      },
      driverLocal,
      vehicleLocal
    );
  }

  // 4) Plantao — turno de disponibilidade do motorista, sem viagem
  // especifica (ver comentario em types.ts). Complementa Reservation: cobre
  // motorista com horario definido no SIAT mas ainda sem corrida despachada
  // no periodo (senao ele simplesmente nao aparece em escala nenhuma).
  // Frequentemente sem veiculo atribuido ainda — cria a Escala mesmo assim
  // (vehicleId opcional), diferente do bloco de Reservation acima.
  for (const { sa, startParts, localDate } of plantoesNoPeriodo) {
    const contexto = `plantão ${sa.id} (${startParts.dateISO})`;
    const driverLocal = driverBySiatId.get(sa.driverId) ?? (sa.driverName ? findDriverByName(sa.driverName, driverByName, allDriversArray) : undefined);
    if (!driverLocal) {
      result.errors.push({ context: contexto, message: sa.driverName ? `Motorista "${sa.driverName}" não encontrado no cadastro.` : "Sem motorista atribuído no SIAT ainda." });
      continue;
    }

    const plate = extractPlate(sa.vehicleInfo);
    // Sem veiculo local: fica null mesmo (plantao pode legitimamente nao ter
    // veiculo definido ainda) — nao gera erro, diferente do bloco acima.
    const vehicleLocal = (sa.vehicleId ? vehicleBySiatId.get(sa.vehicleId) : undefined) ?? (plate ? vehicleByPlate.get(plate) : undefined);
    const endParts = sa.endDatetime ? utcInstantToLocalParts(sa.endDatetime) : null;

    await gravarEscala(
      contexto,
      {
        driverId: driverLocal.id,
        vehicleId: vehicleLocal?.id ?? null,
        date: localDate,
        startTime: startParts.time,
        endTime: endParts?.time ?? null,
        siatId: sa.id,
        fonte: "SIAT",
        scaleName: sa.scaleName,
        routeName: sa.routeName,
        clientName: sa.clientName,
        status: sa.status,
        startDatetime: new Date(sa.startDatetime),
        endDatetime: sa.endDatetime ? new Date(sa.endDatetime) : null,
      },
      driverLocal,
      vehicleLocal
    );
  }

  return result;
}
