"use server";

import { requireRole } from "@/lib/auth";
import { checkAllGaps, DEEP_GAP_WINDOW_DAYS, type AllGapChecks } from "@/lib/integrationGaps";

// Verificacao avulsa de 60 dias, acionada manualmente (botao) — nao roda
// sozinha em toda visita a pagina porque varrer 60 dias em 4 fontes
// diferentes e mais caro que o necessario pro uso rotineiro (ver
// RECURRING_GAP_WINDOW_DAYS em lib/integrationGaps.ts, usado automatica-
// mente pela propria pagina com 7 dias).
export async function checkDeepGaps(): Promise<AllGapChecks> {
  const session = await requireRole("ADMIN", "GESTOR");
  return checkAllGaps(session.companyId, DEEP_GAP_WINDOW_DAYS);
}
