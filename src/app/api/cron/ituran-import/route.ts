import { NextRequest, NextResponse } from "next/server";
import { endOfDay, format, startOfDay, subDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { fetchTrips, fetchVehiclesRealtime, isIturanAvailable } from "@/lib/ituran/client";
import { matchEscalaForVehicleTrips } from "@/lib/vehicleTripEscala";

// Agendado no vercel.json pra rodar as 06:00 UTC (= 03:00 horario de
// Brasilia), depois do cron do TiqueTaque (02:00 BRT). Busca o snapshot de
// posicao atual da frota inteira e as viagens de ONTEM (D-1), pra manter
// /telemetria e /telemetria/viagens sempre atualizados sem clique manual.
//
// Ao contrario do TiqueTaque (que exige 1 chamada HTTP por funcionario), os
// dois endpoints da Ituran usados aqui (GET /api/v2/vehicles e GET
// /api/v2/trips) ja sao paginados pra frota inteira numa consulta so — o
// volume esperado cabe folgado no teto de 60s do plano Hobby sem precisar
// de auto-encadeamento via waitUntil (ver tiquetaque-import/route.ts pro
// padrao usado quando isso e necessario).
export const maxDuration = 60;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isIturanAvailable()) {
    return NextResponse.json({ error: "Ituran não configurado" }, { status: 200 });
  }

  const yesterday = subDays(new Date(), 1);
  const dateFrom = startOfDay(yesterday);
  const dateTo = endOfDay(yesterday);

  let snapshots;
  let trips;
  try {
    [snapshots, trips] = await Promise.all([fetchVehiclesRealtime(), fetchTrips(dateFrom, dateTo)]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha ao buscar dados da Ituran." },
      { status: 200 }
    );
  }

  const companies = await prisma.company.findMany({ select: { id: true } });

  let readingsCreated = 0;
  let tripsUpserted = 0;
  let tripsSemEscala = 0;
  const errors: string[] = [];

  for (const company of companies) {
    const [vehicles, escalas] = await Promise.all([
      prisma.vehicle.findMany({ where: { companyId: company.id }, select: { id: true, plate: true } }),
      prisma.escala.findMany({
        where: { companyId: company.id, date: { gte: dateFrom, lte: dateTo } },
        select: { id: true, vehicleId: true, date: true },
      }),
    ]);
    const vehicleIdByPlate = new Map(vehicles.map((v) => [v.plate.trim().toUpperCase(), v.id]));
    if (vehicleIdByPlate.size === 0) continue;

    const companySnapshots = snapshots.filter((s) => vehicleIdByPlate.has(s.plate));
    const readingsData = companySnapshots
      .filter((s) => s.latitude != null && s.longitude != null && s.speedKmh != null && s.recordedAt)
      .map((s) => ({
        companyId: company.id,
        vehicleId: vehicleIdByPlate.get(s.plate) as string,
        speedKmh: s.speedKmh as number,
        latitude: s.latitude as number,
        longitude: s.longitude as number,
        odometerKm: s.odometerKm,
        speedLimitKmh: s.speedLimitKmh,
        recordedAt: s.recordedAt as Date,
        provider: "Ituran",
      }));
    if (readingsData.length > 0) {
      await prisma.telemetryReading.createMany({ data: readingsData });
      readingsCreated += readingsData.length;
    }

    const companyTrips = trips.filter((t) => vehicleIdByPlate.has(t.plate));
    const tripVehicleIds = companyTrips.map((t) => ({ vehicleId: vehicleIdByPlate.get(t.plate) as string, startAt: t.startAt }));
    const matches = matchEscalaForVehicleTrips(tripVehicleIds, escalas);

    for (let i = 0; i < companyTrips.length; i++) {
      const t = companyTrips[i];
      const vehicleId = vehicleIdByPlate.get(t.plate) as string;
      const escalaId = matches.get(i) ?? null;
      if (!escalaId) tripsSemEscala++;
      try {
        await prisma.vehicleTrip.upsert({
          where: { iturarTripId: t.iturarTripId },
          create: {
            companyId: company.id,
            vehicleId,
            iturarTripId: t.iturarTripId,
            startAt: t.startAt,
            endAt: t.endAt,
            distanceKm: t.distanceKm,
            maxSpeedKmh: t.maxSpeedKmh,
            idleMinutes: t.idleMinutes,
            driverNameRaw: t.driverNameRaw,
            escalaId,
          },
          update: {
            endAt: t.endAt,
            distanceKm: t.distanceKm,
            maxSpeedKmh: t.maxSpeedKmh,
            idleMinutes: t.idleMinutes,
            driverNameRaw: t.driverNameRaw,
            escalaId,
          },
        });
        tripsUpserted++;
      } catch (e) {
        errors.push(`viagem ${t.iturarTripId} (${t.plate}): ${e instanceof Error ? e.message : "erro desconhecido"}`);
      }
    }
  }

  return NextResponse.json({
    date: format(yesterday, "yyyy-MM-dd"),
    readingsCreated,
    tripsUpserted,
    tripsSemEscala,
    errors,
  });
}
