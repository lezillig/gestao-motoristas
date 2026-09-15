import { NextRequest } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { isSiatAvailable } from "@/lib/siat/client";
import { syncFromSiatCore } from "@/lib/sync/siat";
import { brazilDayLabel } from "@/lib/date";
import { executarCron } from "@/lib/cronRun";
import { filtroEmpresaDasIntegracoes } from "@/lib/integracoesEmpresa";

// Diario (ver vercel.json): escalas de ONTEM (calendario de Brasilia) do SIAT.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return executarCron("siat-import", req, async () => {
    if (!isSiatAvailable()) return { status: "pulado", detalhe: { skipped: "SIAT não configurado" } };

    const date = format(brazilDayLabel(-1), "yyyy-MM-dd");
    const companies = await prisma.company.findMany({ where: await filtroEmpresaDasIntegracoes(), select: { id: true } });

    const results = [];
    const errors: string[] = [];
    let processados = 0;
    for (const company of companies) {
      try {
        const result = await syncFromSiatCore(company.id, date, date);
        results.push({ companyId: company.id, ...result });
        // Processado = conferido, gravado ou nao. Com a gravacao so do que
        // mudou, um dia ja sincronizado grava zero; contar so gravados faria o
        // registro marcar "erro" (nada processado + avisos de reserva sem
        // motorista) todos os dias.
        processados +=
          result.vehicles.created + result.vehicles.updated + result.vehicles.unchanged +
          result.drivers.created + result.drivers.updated + result.drivers.unchanged +
          result.escalas.created + result.escalas.updated + result.escalas.unchanged;
        errors.push(...result.errors.map((e) => `${e.context}: ${e.message}`));
      } catch (e) {
        errors.push(`${company.id}: ${e instanceof Error ? e.message : "falha"}`);
      }
    }

    return { status: "ok", processados, erros: errors, detalhe: { date, results } };
  });
}
