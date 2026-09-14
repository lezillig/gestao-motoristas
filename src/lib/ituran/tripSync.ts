import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { matchEscalaForVehicleTrips } from "@/lib/vehicleTripEscala";
import type { IturanTrip } from "./types";

export type TripSyncResult = {
  // Viagens da empresa processadas: criadas + atualizadas + ja iguais.
  upserted: number;
  criadas: number;
  atualizadas: number;
  semEscala: number;
  errors: string[];
  // true quando o orcamento de tempo acabou antes de gravar todas as
  // alteracoes — o restante entra na proxima execucao (nada duplica).
  incompleto: boolean;
};

const LOTE_LEITURA = 1000;
const LOTE_CRIACAO = 500;
const LOTE_ATUALIZACAO = 25;

const SELECT_EXISTENTE = {
  iturarTripId: true,
  endAt: true,
  distanceKm: true,
  maxSpeedKmh: true,
  idleMinutes: true,
  driverNameRaw: true,
  startLat: true,
  startLon: true,
  startAddress: true,
  endLat: true,
  endLon: true,
  endAddress: true,
  escalaId: true,
} satisfies Prisma.VehicleTripSelect;

type Existente = Prisma.VehicleTripGetPayload<{ select: typeof SELECT_EXISTENTE }>;
type Alteracao = Omit<Existente, "iturarTripId">;

function mudou(e: Existente, d: Alteracao): boolean {
  return (
    e.endAt.getTime() !== d.endAt.getTime() ||
    e.distanceKm !== d.distanceKm ||
    e.maxSpeedKmh !== d.maxSpeedKmh ||
    e.idleMinutes !== d.idleMinutes ||
    e.driverNameRaw !== d.driverNameRaw ||
    e.startLat !== d.startLat ||
    e.startLon !== d.startLon ||
    e.startAddress !== d.startAddress ||
    e.endLat !== d.endLat ||
    e.endLon !== d.endLon ||
    e.endAddress !== d.endAddress ||
    e.escalaId !== d.escalaId
  );
}

function lotes<T>(itens: T[], tamanho: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}

// Grava as viagens (VehicleTrip) de UMA empresa a partir de uma lista da
// Ituran ja buscada (`trips`, pode cobrir mais de uma empresa — filtra por
// placa cadastrada aqui). Compartilhado entre o cron diario
// (api/cron/ituran-import, sempre D-1) e o backfill manual (Integrações).
// `dateFrom`/`dateTo` sao rotulos de dia e servem so pra achar a Escala com
// que cada viagem casa; nao filtram `trips`.
//
// Em lote: 1 leitura das viagens ja existentes, createMany das novas e
// update so das que mudaram. Antes era um upsert sequencial por viagem, o
// que num dia cheio (centenas de viagens) consumia boa parte dos 60s.
export async function syncVehicleTripsForCompany(
  companyId: string,
  trips: IturanTrip[],
  dateFrom: Date,
  dateTo: Date,
  opts: { deadline?: number } = {}
): Promise<TripSyncResult> {
  const result: TripSyncResult = { upserted: 0, criadas: 0, atualizadas: 0, semEscala: 0, errors: [], incompleto: false };

  const [vehicles, escalas] = await Promise.all([
    prisma.vehicle.findMany({ where: { companyId }, select: { id: true, plate: true } }),
    prisma.escala.findMany({
      where: { companyId, date: { gte: dateFrom, lte: dateTo } },
      select: { id: true, vehicleId: true, date: true },
    }),
  ]);
  const vehicleIdByPlate = new Map(vehicles.map((v) => [v.plate.trim().toUpperCase(), v.id]));
  if (vehicleIdByPlate.size === 0) return result;

  const companyTrips = trips.filter((t) => vehicleIdByPlate.has(t.plate));
  if (companyTrips.length === 0) return result;
  const matches = matchEscalaForVehicleTrips(
    companyTrips.map((t) => ({ vehicleId: vehicleIdByPlate.get(t.plate) as string, startAt: t.startAt })),
    escalas
  );

  const existentes = new Map<string, Existente>();
  for (const lote of lotes([...new Set(companyTrips.map((t) => t.iturarTripId))], LOTE_LEITURA)) {
    const rows = await prisma.vehicleTrip.findMany({ where: { iturarTripId: { in: lote } }, select: SELECT_EXISTENTE });
    for (const r of rows) existentes.set(r.iturarTripId, r);
  }

  const novas: Prisma.VehicleTripCreateManyInput[] = [];
  const alteradas: { iturarTripId: string; plate: string; data: Alteracao }[] = [];
  const vistas = new Set<string>();

  companyTrips.forEach((t, i) => {
    if (vistas.has(t.iturarTripId)) return; // mesma viagem repetida entre paginas
    vistas.add(t.iturarTripId);
    const escalaId = matches.get(i) ?? null;
    if (!escalaId) result.semEscala++;
    const data: Alteracao = {
      endAt: t.endAt,
      distanceKm: t.distanceKm,
      maxSpeedKmh: t.maxSpeedKmh,
      idleMinutes: t.idleMinutes,
      driverNameRaw: t.driverNameRaw,
      startLat: t.startLat,
      startLon: t.startLon,
      startAddress: t.startAddress,
      endLat: t.endLat,
      endLon: t.endLon,
      endAddress: t.endAddress,
      escalaId,
    };
    const existente = existentes.get(t.iturarTripId);
    if (!existente) {
      novas.push({ companyId, vehicleId: vehicleIdByPlate.get(t.plate) as string, iturarTripId: t.iturarTripId, startAt: t.startAt, ...data });
      return;
    }
    result.upserted++;
    if (mudou(existente, data)) alteradas.push({ iturarTripId: t.iturarTripId, plate: t.plate, data });
  });

  for (const lote of lotes(novas, LOTE_CRIACAO)) {
    try {
      const r = await prisma.vehicleTrip.createMany({ data: lote, skipDuplicates: true });
      result.criadas += r.count;
      result.upserted += lote.length;
    } catch (e) {
      result.errors.push(`${lote.length} viagem(ns) nova(s) não gravada(s): ${e instanceof Error ? e.message : "erro desconhecido"}`);
    }
  }

  for (const lote of lotes(alteradas, LOTE_ATUALIZACAO)) {
    if (opts.deadline && Date.now() > opts.deadline) {
      result.incompleto = true;
      break;
    }
    try {
      await prisma.$transaction(lote.map((a) => prisma.vehicleTrip.update({ where: { iturarTripId: a.iturarTripId }, data: a.data })));
      result.atualizadas += lote.length;
    } catch {
      // Um item ruim nao pode derrubar o lote inteiro: refaz um a um so pra
      // saber qual falhou.
      for (const a of lote) {
        try {
          await prisma.vehicleTrip.update({ where: { iturarTripId: a.iturarTripId }, data: a.data });
          result.atualizadas++;
        } catch (e) {
          result.errors.push(`viagem ${a.iturarTripId} (${a.plate}): ${e instanceof Error ? e.message : "erro desconhecido"}`);
        }
      }
    }
  }

  return result;
}
