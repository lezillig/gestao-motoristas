import { NextRequest } from "next/server";
import { format, subMonths } from "date-fns";
import { prisma } from "@/lib/prisma";
import { fetchAllEmployees, isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import { sleep, TIQUETAQUE_IMPORT_PACE_MS } from "@/lib/tiquetaque/pace";
import { importTimesheetCore } from "@/lib/tiquetaque/timesheetCore";
import { brazilDayLabel } from "@/lib/date";
import { executarCron } from "@/lib/cronRun";
import { filtroEmpresaDasIntegracoes } from "@/lib/integracoesEmpresa";

// Diario, 04:20 UTC (antes do cron de ponto, que divide o mesmo limite de
// 60 req/min): espelho mensal apurado (horas normais, extras 50/100,
// noturno, DSR...) de cada motorista pro mes corrente — e pro mes anterior
// nos primeiros dias do mes, quando o fechamento ainda muda. Processa ate o
// orcamento e chama a si mesma com ?cursor=&meses= ate esgotar.
export const maxDuration = 60;

const BATCH_TIME_BUDGET_MS = 45_000;
const HARD_DEADLINE_MS = 50_000;
const DIAS_PARA_REVISAR_MES_ANTERIOR = 5;

export async function GET(req: NextRequest) {
  return executarCron("tiquetaque-timesheets", req, async ({ iniciadoEm, encadear }) => {
    if (!isTiqueTaqueAvailable()) return { status: "pulado", detalhe: { skipped: "TiqueTaque não configurado" } };

    const deadline = iniciadoEm + HARD_DEADLINE_MS;
    const cursorRaw = parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10);
    const cursor = Number.isFinite(cursorRaw) && cursorRaw >= 0 ? cursorRaw : 0;

    const hoje = brazilDayLabel(0);
    const mesesParam = req.nextUrl.searchParams.get("meses");
    const meses = mesesParam
      ? mesesParam.split(",").filter((m) => /^\d{4}-\d{2}$/.test(m))
      : [format(hoje, "yyyy-MM"), ...(hoje.getDate() <= DIAS_PARA_REVISAR_MES_ANTERIOR ? [format(subMonths(hoje, 1), "yyyy-MM")] : [])];

    const companies = await prisma.company.findMany({ where: await filtroEmpresaDasIntegracoes(), select: { id: true }, orderBy: { id: "asc" } });
    const drivers = (
      await Promise.all(
        companies.map((c) =>
          prisma.driver.findMany({
            where: { companyId: c.id, active: true },
            select: { id: true, name: true, cpf: true, companyId: true },
            orderBy: { id: "asc" },
          })
        )
      )
    ).flat();
    const itens = drivers.flatMap((d) => meses.map((mes) => ({ ...d, mes })));

    const employees = await fetchAllEmployees(deadline);
    const employeeByCpf = new Map(employees.map((e) => [e.cpf.replace(/\D/g, ""), e]));

    let processed = 0;
    let semVinculo = 0;
    const errors: string[] = [];
    let i = cursor;
    for (; i < itens.length; i++) {
      if (Date.now() - iniciadoEm > BATCH_TIME_BUDGET_MS) break;
      const item = itens[i];
      const employeeId = employeeByCpf.get(item.cpf.replace(/\D/g, ""))?.id;
      if (!employeeId) {
        semVinculo++;
        continue;
      }
      if (i > cursor) await sleep(TIQUETAQUE_IMPORT_PACE_MS);
      try {
        await importTimesheetCore(item.companyId, item.id, employeeId, item.mes, deadline);
        processed++;
      } catch (e) {
        errors.push(`${item.name} ${item.mes}: ${e instanceof Error ? e.message : "falha"}`);
      }
    }

    const remaining = i < itens.length;
    if (remaining) encadear({ cursor: String(i), meses: meses.join(",") });

    return {
      status: "ok",
      processados: processed,
      erros: errors,
      continuacao: remaining,
      detalhe: { meses, cursorStart: cursor, cursorEnd: i, total: itens.length, semVinculo },
    };
  });
}
