import { prisma } from "@/lib/prisma";
import { matchEscalaForVehicleTrips } from "@/lib/vehicleTripEscala";
import type { IturanTrip } from "./types";

export type TripSyncResult = { upserted: number; semEscala: number; errors: string[] };

// Upsert de viagens (VehicleTrip) de UMA empresa a partir de uma lista de
// viagens da Ituran ja buscada (`trips`, pode cobrir mais de uma empresa —
// filtra por placa cadastrada aqui) — compartilhado entre o cron diario
// (api/cron/ituran-import, sempre D-1) e o backfill manual (Integrações,
// pra reimportar um intervalo especifico com lacuna, ja que o cron sozinho
// nunca alcança um dia que passou batido). `dateFrom`/`dateTo` aqui e so
// pra resolver contra qual Escala casar a viagem, nao filtra `trips` (isso
// ja deve vir filtrado de quem chamou, via fetchTrips).
export async function syncVehicleTripsForCompany(
  companyId: string,
  trips: IturanTrip[],
  dateFrom: Date,
  dateTo: Date
): Promise<TripSyncResult> {
  const [vehicles, escalas] = await Promise.all([
    prisma.vehicle.findMany({ where: { companyId }, select: { id: true, plate: true } }),
    prisma.escala.findMany({
      where: { companyId, date: { gte: dateFrom, lte: dateTo } },
      select: { id: true, vehicleId: true, date: true },
    }),
  ]);
  const vehicleIdByPlate = new Map(vehicles.map((v) => [v.plate.trim().toUpperCase(), v.id]));
  if (vehicleIdByPlate.size === 0) return { upserted: 0, semEscala: 0, errors: [] };

  const companyTrips = trips.filter((t) => vehicleIdByPlate.has(t.plate));
  const tripVehicleIds = companyTrips.map((t) => ({ vehicleId: vehicleIdByPlate.get(t.plate) as string, startAt: t.startAt }));
  const matches = matchEscalaForVehicleTrips(tripVehicleIds, escalas);

  let upserted = 0;
  let semEscala = 0;
  const errors: string[] = [];
  for (let i = 0; i < companyTrips.length; i++) {
    const t = companyTrips[i];
    const vehicleId = vehicleIdByPlate.get(t.plate) as string;
    const escalaId = matches.get(i) ?? null;
    if (!escalaId) semEscala++;
    try {
      await prisma.vehicleTrip.upsert({
        where: { iturarTripId: t.iturarTripId },
        create: {
          companyId,
          vehicleId,
          iturarTripId: t.iturarTripId,
          startAt: t.startAt,
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
        },
        update: {
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
        },
      });
      upserted++;
    } catch (e) {
      errors.push(`viagem ${t.iturarTripId} (${t.plate}): ${e instanceof Error ? e.message : "erro desconhecido"}`);
    }
  }
  return { upserted, semEscala, errors };
}
