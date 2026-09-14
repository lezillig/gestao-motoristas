import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSofitAvailable } from "@/lib/sofit/client";
import { syncSofitFuelCore } from "@/lib/sync/sofitFuel";
import { executarCron } from "@/lib/cronRun";

// Diario (ver vercel.json): abastecimentos da Sofit desde a ultima
// sincronizacao (cursor = maior dataHora ja importada, ver
// syncSofitFuelCore). Um backfill grande (ex.: desde 2026-01-01 numa conta
// nova) nao cabe numa invocacao: quando o nucleo devolve hasMore, a rota
// chama a si mesma de novo (waitUntil) ate esgotar.
export const maxDuration = 60;

const BATCH_DEADLINE_MS = 45_000;

export async function GET(req: NextRequest) {
  return executarCron("sofit-import", req, async ({ encadear }) => {
    if (!isSofitAvailable()) return { status: "pulado", detalhe: { skipped: "Sofit não configurada" } };

    const deadline = Date.now() + BATCH_DEADLINE_MS;
    const companies = await prisma.company.findMany({ select: { id: true } });

    const results = [];
    const errors: string[] = [];
    let processados = 0;
    let anyMore = false;
    for (const company of companies) {
      try {
        const result = await syncSofitFuelCore(company.id, deadline);
        results.push({ companyId: company.id, ...result });
        processados += result.created;
        if (result.hasMore) anyMore = true;
      } catch (e) {
        errors.push(`${company.id}: ${e instanceof Error ? e.message : "falha"}`);
      }
    }

    if (anyMore) encadear({});

    return { status: "ok", processados, erros: errors, continuacao: anyMore, detalhe: { results } };
  });
}
