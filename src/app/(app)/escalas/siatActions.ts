"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { syncFromSiatCore, type SiatSyncResult } from "@/lib/sync/siat";

export type { SiatSyncResult, SiatSyncRowError } from "@/lib/sync/siat";

// Wrapper com sessao — usado pelo botao "Sincronizar" em /escalas.
export async function syncFromSiat(dateFrom: string, dateTo: string): Promise<SiatSyncResult> {
  const session = await requireRole("ADMIN", "GESTOR");
  // O SIAT e consultado 1 vez por dia do intervalo (limite de 20 req/min):
  // sem teto, um intervalo de anos vira dezenas de milhares de chamadas.
  const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATA_RE.test(dateFrom) || !DATA_RE.test(dateTo) || dateFrom > dateTo) {
    throw new Error("Período inválido — informe datas no formato aaaa-mm-dd, com início antes do fim.");
  }
  const dias = Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000);
  if (dias > 92) {
    throw new Error("Período máximo de 92 dias por sincronização — divida em intervalos menores.");
  }
  const result = await syncFromSiatCore(session.companyId, dateFrom, dateTo);
  revalidatePath("/escalas");
  return result;
}
