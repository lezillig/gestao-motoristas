import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSofitAvailable } from "@/lib/sofit/client";
import { syncSofitCnhCore } from "@/lib/sofit/cnhSync";
import { executarCron } from "@/lib/cronRun";
import { filtroEmpresaDasIntegracoes } from "@/lib/integracoesEmpresa";

// Diario (ver vercel.json): CNH (numero/categoria/validade) dos motoristas a
// partir do cadastro de pessoas da Sofit.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return executarCron("sofit-cnh-import", req, async () => {
    if (!isSofitAvailable()) return { status: "pulado", detalhe: { skipped: "Sofit não configurada" } };

    const companies = await prisma.company.findMany({ where: await filtroEmpresaDasIntegracoes(), select: { id: true } });
    const deadline = Date.now() + 45_000;
    const results: Record<string, unknown>[] = [];
    const errors: string[] = [];
    let processados = 0;
    for (const company of companies) {
      try {
        const result = await syncSofitCnhCore(company.id, deadline);
        results.push({ companyId: company.id, ...result });
        processados += Object.values(result).reduce<number>((s, v) => (typeof v === "number" ? s + v : s), 0);
      } catch (e) {
        errors.push(`${company.id}: ${e instanceof Error ? e.message : "erro desconhecido"}`);
      }
    }

    return { status: "ok", processados, erros: errors, detalhe: { results } };
  });
}
