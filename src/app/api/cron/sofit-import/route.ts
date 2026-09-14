import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSofitAvailable } from "@/lib/sofit/client";
import { syncSofitFuelCore } from "@/lib/sync/sofitFuel";
import { executarCron } from "@/lib/cronRun";

// Diario (ver vercel.json): abastecimentos da Sofit desde a ultima
// sincronizacao (cursor = maior dataHora ja importada, ver syncSofitFuelCore).
// Um backfill grande nao cabe numa invocacao: quando o nucleo devolve
// hasMore, a rota chama a si mesma com ?since=&page=&company= — o mesmo since
// e a proxima pagina, pra retomar exatamente de onde parou. Sem esse cursor,
// cada continuacao recomecava da pagina 1 e podia se reencadear sem avancar.
export const maxDuration = 60;

const BATCH_DEADLINE_MS = 45_000;

export async function GET(req: NextRequest) {
  return executarCron("sofit-import", req, async ({ encadear }) => {
    if (!isSofitAvailable()) return { status: "pulado", detalhe: { skipped: "Sofit não configurada" } };

    const deadline = Date.now() + BATCH_DEADLINE_MS;
    const sinceParam = req.nextUrl.searchParams.get("since");
    const pageParam = req.nextUrl.searchParams.get("page");
    const companyParam = req.nextUrl.searchParams.get("company");

    const sinceDate = sinceParam ? new Date(sinceParam) : undefined;
    if (sinceDate && Number.isNaN(sinceDate.getTime())) {
      return { status: "erro", erros: ["since inválido (use ISO 8601)."], httpStatus: 400 };
    }
    const pageRaw = pageParam ? parseInt(pageParam, 10) : 1;
    const startPage = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

    const companies = await prisma.company.findMany({ select: { id: true }, orderBy: { id: "asc" } });

    const results = [];
    const errors: string[] = [];
    let processados = 0;
    let continuacao = false;
    for (const company of companies) {
      if (companyParam && company.id !== companyParam) continue;
      // since/page vindos da URL so valem pra empresa da continuacao.
      const since = companyParam ? sinceDate : undefined;
      const pagina = companyParam ? startPage : 1;
      try {
        const result = await syncSofitFuelCore(company.id, deadline, since, pagina);
        results.push({ companyId: company.id, created: result.created, skipped: result.skipped, hasMore: result.hasMore, nextPage: result.nextPage });
        processados += result.created;
        if (result.hasMore) {
          if (result.nextPage <= pagina) {
            errors.push(`${company.id}: nenhuma página da Sofit coube no tempo desta execução — continua na próxima.`);
          } else {
            continuacao = true;
            encadear({ since: result.since.toISOString(), page: String(result.nextPage), company: company.id });
          }
        }
      } catch (e) {
        errors.push(`${company.id}: ${e instanceof Error ? e.message : "falha"}`);
      }
    }

    return { status: "ok", processados, erros: errors, continuacao, detalhe: { results } };
  });
}
