"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { fetchTrips } from "@/lib/ituran/client";
import { syncVehicleTripsForCompany } from "@/lib/ituran/tripSync";

export type IturanBackfillState = { error?: string; result?: { upserted: number; semEscala: number } };

// Backfill manual de um intervalo com lacuna (ver painel de lacunas em
// Integrações) — o cron diario (api/cron/ituran-import) SO busca D-1, nunca
// alcança um dia que passou batido; esta action e o unico jeito de
// reimportar um intervalo especifico do passado. `dateFrom`/`dateTo` no
// formato yyyy-MM-dd.
export async function backfillIturanTrips(dateFrom: string, dateTo: string): Promise<IturanBackfillState> {
  const session = await requireRole("ADMIN", "GESTOR");
  try {
    const start = new Date(`${dateFrom}T00:00:00.000Z`);
    const end = new Date(`${dateTo}T23:59:59.999Z`);
    const trips = await fetchTrips(start, end);
    const result = await syncVehicleTripsForCompany(session.companyId, trips, start, end);
    revalidatePath("/telemetria");
    return { result: { upserted: result.upserted, semEscala: result.semEscala } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao buscar viagens da Ituran." };
  }
}
