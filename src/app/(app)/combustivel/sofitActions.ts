"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { brazilDateStringToUtc } from "@/lib/date";
import { syncSofitFuelCore } from "@/lib/sync/sofitFuel";
import { exigirIntegracoesDaEmpresa } from "@/lib/integracoesEmpresa";

export type SofitSyncState = { error?: string; result?: { created: number; skipped: number; hasMore: boolean } };

// Botao manual "Sincronizar com Sofit" — usa useActionState (ver
// SofitSyncButton.tsx) pra mostrar "Sincronizando..." enquanto roda, em vez
// de ficar sem nenhum feedback visivel (mesmo problema ja corrigido no
// "Gerar leituras" de /telemetria).
export async function syncSofitFuel(_prevState: SofitSyncState): Promise<SofitSyncState> {
  const session = await requireRole("ADMIN", "GESTOR");
  await exigirIntegracoesDaEmpresa(session.companyId);
  try {
    // 45s de orcamento pro fetch em si, deixando folga pro resto da acao
    // (queries, createMany) dentro do teto real da funcao serverless.
    const result = await syncSofitFuelCore(session.companyId, Date.now() + 45_000);
    revalidatePath("/combustivel");
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao sincronizar com a Sofit." };
  }
}

// Backfill manual de uma lacuna especifica (ver painel de lacunas em
// Integrações) — mesma logica do botao normal, so que comeca no dia da
// lacuna em vez de "desde a ultima sincronizacao". `since` no formato
// yyyy-MM-dd.
export async function backfillSofitFuel(since: string): Promise<SofitSyncState> {
  const session = await requireRole("ADMIN", "GESTOR");
  await exigirIntegracoesDaEmpresa(session.companyId);
  try {
    const result = await syncSofitFuelCore(session.companyId, Date.now() + 45_000, brazilDateStringToUtc(since));
    revalidatePath("/combustivel");
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao sincronizar com a Sofit." };
  }
}
