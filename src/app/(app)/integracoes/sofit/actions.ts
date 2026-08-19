"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { parseLocalDate } from "@/lib/date";
import { testSofitConnection, type SofitConnectionTest } from "@/lib/sofit/client";
import { isSofitConfigured } from "@/lib/sofit/config";
import { runSofitSync } from "@/lib/sofit/importCore";
import { SOFIT_ENTITIES, type SofitSyncEntityResult } from "@/lib/sofit/types";

export type SofitSyncState = {
  error?: string;
  results?: SofitSyncEntityResult[];
};

export async function testarConexaoSofit(): Promise<SofitConnectionTest> {
  await requireRole("ADMIN", "GESTOR");
  return testSofitConnection();
}

// Sincronizacao disparada da tela. Uma entidade por vez ja e feito dentro de
// runSofitSync; aqui o teto de tempo e o da Server Action (mesmo limite de
// 60s da funcao serverless), entao o formulario limita o periodo a 92 dias
// — periodo maior deve ir pelo agendamento diario, que se auto-encadeia.
const MAX_DIAS_SYNC_MANUAL = 92;

export async function sincronizarSofit(
  _prevState: SofitSyncState,
  formData: FormData
): Promise<SofitSyncState> {
  const session = await requireRole("ADMIN", "GESTOR");

  if (!isSofitConfigured()) {
    return { error: "Integração com o Sofit não configurada. Defina as variáveis de ambiente SOFIT_* e recarregue." };
  }

  const entidades = SOFIT_ENTITIES.filter((entidade) => formData.get(`entidade_${entidade}`) === "on");
  if (entidades.length === 0) {
    return { error: "Selecione ao menos uma entidade para sincronizar." };
  }

  const start = parseLocalDate(String(formData.get("startDate") ?? ""));
  const end = parseLocalDate(String(formData.get("endDate") ?? ""));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: "Informe o período (data inicial e final)." };
  }
  if (end < start) {
    return { error: "A data final não pode ser anterior à inicial." };
  }
  const dias = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (dias > MAX_DIAS_SYNC_MANUAL) {
    return {
      error: `Período muito longo (${dias} dias). Sincronize no máximo ${MAX_DIAS_SYNC_MANUAL} dias por vez — o agendamento diário cobre o histórico contínuo.`,
    };
  }

  // Fim do periodo no ULTIMO instante do dia: o filtro do Sofit e por data,
  // mas quem consome o resultado (dedup por data/hora) trabalha com o
  // instante — end as 00:00 descartaria o proprio dia final.
  const endOfDay = new Date(end);
  endOfDay.setHours(23, 59, 59, 999);

  const results = await runSofitSync(session.companyId, {
    entidades,
    period: { start, end: endOfDay },
    origem: "MANUAL",
    executadoPor: session.userId,
  });

  revalidatePath("/integracoes/sofit");
  revalidatePath("/cadastros/veiculos");
  revalidatePath("/combustivel");
  return { results };
}
