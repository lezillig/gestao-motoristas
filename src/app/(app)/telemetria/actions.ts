"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { fetchTrips } from "@/lib/ituran/client";
import { syncVehicleTripsForCompany } from "@/lib/ituran/tripSync";
import { brazilDateStringToUtc, parseLocalDate } from "@/lib/date";

export type IturanBackfillState = { error?: string; result?: { upserted: number; semEscala: number } };

// Backfill manual de um intervalo com lacuna (ver painel de lacunas em
// Integrações) — o cron diario (api/cron/ituran-import) SO busca D-1, nunca
// alcança um dia que passou batido; esta action e o unico jeito de
// reimportar um intervalo especifico do passado. `dateFrom`/`dateTo` no
// formato yyyy-MM-dd.
export async function backfillIturanTrips(dateFrom: string, dateTo: string): Promise<IturanBackfillState> {
  const session = await requireRole("ADMIN", "GESTOR");
  try {
    // `dateFrom`/`dateTo` vem do painel de lacunas, ja rotulados por dia-
    // calendario de Brasilia (ver lib/integrationGaps.ts) — a janela pra
    // API da Ituran precisa do instante UTC real de cada meia-noite em
    // Brasilia (ver brazilDateStringToUtc), senao um dia pedido pra
    // reimportar podia vir incompleto (confirmado real, 2026-09-09: um
    // backfill grande deixou 1 dia de fora por causa desse deslocamento).
    const apiStart = brazilDateStringToUtc(dateFrom);
    const apiEnd = new Date(brazilDateStringToUtc(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1);
    const trips = await fetchTrips(apiStart, apiEnd);

    // Escala.date e um ROTULO de data sem hora real (ver parseLocalDate) —
    // usa esse formato aqui, NAO o instante BRT acima, senao a escala do
    // proprio dia (gravada como UTC-meia-noite) ficaria fora do intervalo.
    const escalaStart = parseLocalDate(dateFrom);
    const escalaEnd = parseLocalDate(dateTo);
    const result = await syncVehicleTripsForCompany(session.companyId, trips, escalaStart, escalaEnd);
    revalidatePath("/telemetria");
    return { result: { upserted: result.upserted, semEscala: result.semEscala } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao buscar viagens da Ituran." };
  }
}
