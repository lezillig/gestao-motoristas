import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTicketLogAvailable, fetchFuelCardStatuses } from "@/lib/ticketlog/client";
import { syncTicketLogCardStatusesCore } from "@/lib/sync/ticketlogCards";
import { executarCron } from "@/lib/cronRun";
import { filtroEmpresaDasIntegracoes } from "@/lib/integracoesEmpresa";

// Diario (ver vercel.json): snapshot do status dos cartoes de combustivel
// Ticket Log, uma chamada na API e upsert por empresa.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return executarCron("ticketlog-import", req, async () => {
    if (!isTicketLogAvailable()) return { status: "pulado", detalhe: { skipped: "Ticket Log não configurado" } };

    const companies = await prisma.company.findMany({ where: await filtroEmpresaDasIntegracoes(), select: { id: true } });
    const statuses = await fetchFuelCardStatuses();

    const results = [];
    const errors: string[] = [];
    let processados = 0;
    for (const company of companies) {
      try {
        const result = await syncTicketLogCardStatusesCore(company.id, statuses);
        results.push({ companyId: company.id, ...result });
        processados += result.count;
      } catch (e) {
        errors.push(`${company.id}: ${e instanceof Error ? e.message : "falha"}`);
      }
    }

    return { status: "ok", processados, erros: errors, detalhe: { results } };
  });
}
