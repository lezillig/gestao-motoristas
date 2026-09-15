"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { isSofitAvailable } from "@/lib/sofit/client";
import { atualizarUltimaManutencao, syncOrdensServicoSofit, syncVeiculosSofit, ultimoCursorOs } from "@/lib/sofit/manutencaoSync";
import { auditarSofit, registrarSnapshotAuditoria } from "@/lib/sofit/auditoria";
import { exigirIntegracoesDaEmpresa } from "@/lib/integracoesEmpresa";

export type SyncManutencaoResult = {
  error?: string;
  result?: {
    veiculos?: { atualizados: number; semPar: number; vencimentos: number };
    osUpserted: number;
    osSemVeiculo: number;
    hasMore: boolean;
    nextSince: string;
    ultimaManutencaoAtualizada?: number;
  };
};

const BUDGET_MS = 40_000;

// Uma chamada = um lote de ate ~40s (teto de 60s do plano Hobby). O cliente
// repete enquanto hasMore, passando nextSince de volta. Na PRIMEIRA chamada
// (sinceISO nulo) tambem sincroniza a frota da Sofit (disponibilidade,
// intervalos, vencimentos — rapido, 15 paginas); ao terminar o ultimo lote,
// recalcula a ultima manutencao por veiculo.
export async function syncManutencaoSofit(sinceISO: string | null): Promise<SyncManutencaoResult> {
  const session = await requireRole("ADMIN", "GESTOR");
  await exigirIntegracoesDaEmpresa(session.companyId);
  if (!isSofitAvailable()) return { error: "Sofit não configurada (SOFIT_API_URL/SOFIT_TOKEN)." };
  const deadline = Date.now() + BUDGET_MS;
  try {
    const veiculos = sinceISO ? undefined : await syncVeiculosSofit(session.companyId, deadline);
    const since = sinceISO ? new Date(sinceISO) : await ultimoCursorOs(session.companyId);
    const r = await syncOrdensServicoSofit(session.companyId, since, deadline);
    const ultimaManutencaoAtualizada = r.hasMore ? undefined : await atualizarUltimaManutencao(session.companyId);
    if (!r.hasMore) {
      // Fim da sincronizacao: grava o retrato do dia da auditoria (grafico de
      // evolucao). Falha aqui nao derruba o sync, que ja foi concluido.
      await auditarSofit(session.companyId)
        .then((a) => registrarSnapshotAuditoria(session.companyId, a))
        .catch(() => {});
      revalidatePath("/manutencao/auditoria");
    }
    revalidatePath("/manutencao");
    revalidatePath("/hoje");
    revalidatePath("/utilizacao");
    return {
      result: { veiculos, osUpserted: r.upserted, osSemVeiculo: r.semVeiculo, hasMore: r.hasMore, nextSince: r.nextSince.toISOString(), ultimaManutencaoAtualizada },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao sincronizar manutenção da Sofit." };
  }
}
