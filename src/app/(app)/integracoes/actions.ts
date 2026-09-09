"use server";

import { requireRole } from "@/lib/auth";
import {
  checkAllGaps,
  checkTiqueTaquePontoGaps,
  checkSiatGaps,
  checkSofitGaps,
  checkIturanGaps,
  DEEP_GAP_WINDOW_DAYS,
  type AllGapChecks,
  type GapCheck,
} from "@/lib/integrationGaps";

// Verificacao avulsa de 60 dias, acionada manualmente (botao) — nao roda
// sozinha em toda visita a pagina porque varrer 60 dias em 4 fontes
// diferentes e mais caro que o necessario pro uso rotineiro (ver
// RECURRING_GAP_WINDOW_DAYS em lib/integrationGaps.ts, usado automatica-
// mente pela propria pagina com 7 dias).
export async function checkDeepGaps(): Promise<AllGapChecks> {
  const session = await requireRole("ADMIN", "GESTOR");
  return checkAllGaps(session.companyId, DEEP_GAP_WINDOW_DAYS);
}

// Re-checagem de UM sistema so, na mesma janela que estava sendo exibida
// (7 ou 60 dias) — chamado depois de um "Importar todas datas faltantes"
// bem-sucedido, senao o painel continuava mostrando a lacuna antiga mesmo
// depois de corrigida (confirmado real, 2026-09-09: usuario reimportou a
// Ituran e o painel seguia dizendo "1 dia sem dado").
export async function checkGapsFor(system: keyof AllGapChecks, days: number): Promise<GapCheck> {
  const session = await requireRole("ADMIN", "GESTOR");
  switch (system) {
    case "tiquetaquePonto":
      return checkTiqueTaquePontoGaps(session.companyId, days);
    case "siat":
      return checkSiatGaps(session.companyId, days);
    case "sofit":
      return checkSofitGaps(session.companyId, days);
    case "ituran":
      return checkIturanGaps(session.companyId, days);
  }
}
