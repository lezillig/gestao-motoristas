import { NextRequest } from "next/server";
import { isSofitAvailable } from "@/lib/sofit/client";
import { prisma } from "@/lib/prisma";
import { atualizarUltimaManutencao, syncOrdensServicoSofit, syncVeiculosSofit, ultimoCursorOs } from "@/lib/sofit/manutencaoSync";
import { executarCron } from "@/lib/cronRun";

// Diario (ver vercel.json): veiculos (status, hodometro, plano, vencimentos)
// e ordens de servico da Sofit. OS e incremental por updated_at; quando nao
// cabe no orcamento, a rota chama a si mesma com ?since=<cursor>&company=.
export const maxDuration = 60;
const BUDGET_MS = 40_000;

export async function GET(req: NextRequest) {
  return executarCron("sofit-manutencao", req, async ({ encadear }) => {
    if (!isSofitAvailable()) return { status: "pulado", detalhe: { skipped: "Sofit não configurada" } };

    const deadline = Date.now() + BUDGET_MS;
    const sinceParam = req.nextUrl.searchParams.get("since");
    const companyParam = req.nextUrl.searchParams.get("company");
    const sinceDate = sinceParam ? new Date(sinceParam) : null;
    if (sinceDate && Number.isNaN(sinceDate.getTime())) {
      return { status: "erro", erros: ["since inválido (use ISO 8601)."], httpStatus: 400 };
    }
    const companies = await prisma.company.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    const out: Record<string, unknown>[] = [];
    const errors: string[] = [];
    let processados = 0;
    let continuacao = false;

    for (const company of companies) {
      if (companyParam && company.id !== companyParam) continue;
      try {
        const veiculos = sinceParam ? undefined : await syncVeiculosSofit(company.id, deadline);
        const since = sinceDate ?? (await ultimoCursorOs(company.id));
        const r = await syncOrdensServicoSofit(company.id, since, deadline);
        let ultima: number | undefined;
        if (r.hasMore) {
          continuacao = true;
          encadear({ since: r.nextSince.toISOString(), company: company.id });
        } else {
          ultima = await atualizarUltimaManutencao(company.id);
        }
        processados += r.upserted + (veiculos ? Object.values(veiculos).reduce<number>((s, v) => (typeof v === "number" ? s + v : s), 0) : 0);
        out.push({ company: company.id, veiculos, osUpserted: r.upserted, osSemVeiculo: r.semVeiculo, continued: r.hasMore, ultimaManutencaoAtualizada: ultima });
      } catch (e) {
        errors.push(`${company.id}: ${e instanceof Error ? e.message : "falha"}`);
      }
    }
    return { status: "ok", processados, erros: errors, continuacao, detalhe: { results: out } };
  });
}
