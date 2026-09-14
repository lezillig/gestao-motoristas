import { NextRequest } from "next/server";
import { format } from "date-fns";
import { brazilDayLabel, brazilMidnightUtc } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { fetchTrips, fetchVehiclesRealtime, isIturanAvailable } from "@/lib/ituran/client";
import { syncVehicleTripsForCompany } from "@/lib/ituran/tripSync";
import { updateVehicleMileageFromReadings } from "@/lib/maintenance";
import { executarCron } from "@/lib/cronRun";

// Diario (ver vercel.json): snapshot de posicao/velocidade de toda a frota +
// viagens de ONTEM (calendario de Brasilia) casadas com a escala do dia.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return executarCron("ituran-import", req, async () => {
    if (!isIturanAvailable()) return { status: "pulado", detalhe: { skipped: "Ituran não configurada" } };

    // "Ontem" no calendario de Brasilia: a API da Ituran recebe os instantes
    // reais das meias-noites BRT (senao as viagens das 21h-23h59 ficavam pro
    // lote seguinte) e as escalas sao casadas pelo rotulo do dia.
    const dateFrom = brazilMidnightUtc(-1);
    const dateTo = new Date(brazilMidnightUtc(0).getTime() - 1);
    const yesterday = brazilDayLabel(-1);

    const [snapshots, trips] = await Promise.all([fetchVehiclesRealtime(), fetchTrips(dateFrom, dateTo)]);
    const companies = await prisma.company.findMany({ select: { id: true } });

    let readingsCreated = 0;
    let tripsUpserted = 0;
    let tripsSemEscala = 0;
    const errors: string[] = [];

    for (const company of companies) {
      const vehicles = await prisma.vehicle.findMany({ where: { companyId: company.id }, select: { id: true, plate: true } });
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
        await updateVehicleMileageFromReadings(readingsData);
      }

      const tripResult = await syncVehicleTripsForCompany(company.id, trips, yesterday, yesterday);
      tripsUpserted += tripResult.upserted;
      tripsSemEscala += tripResult.semEscala;
      errors.push(...tripResult.errors);
    }

    return {
      status: "ok",
      processados: readingsCreated + tripsUpserted,
      erros: errors,
      detalhe: { date: format(yesterday, "yyyy-MM-dd"), readingsCreated, tripsUpserted, tripsSemEscala },
    };
  });
}
