import { NextRequest } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { fetchAllEmployees, isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import { sleep, TIQUETAQUE_IMPORT_PACE_MS } from "@/lib/tiquetaque/pace";
import { importDriverDaysCore } from "@/lib/tiquetaque/importCore";
import { brazilDayLabel } from "@/lib/date";
import { executarCron } from "@/lib/cronRun";

// Diario (ver vercel.json): batidas de ONTEM (calendario de Brasilia) de
// cada motorista, uma chamada por motorista com pausa (60 req/min
// compartilhados). Processa ate o orcamento e chama a si mesma com
// ?cursor=<indice>&date=<dia> ate esgotar a lista.
export const maxDuration = 60;

const BATCH_TIME_BUDGET_MS = 45_000;
const HARD_DEADLINE_MS = 50_000;

export async function GET(req: NextRequest) {
  return executarCron("tiquetaque-import", req, async ({ iniciadoEm, encadear }) => {
    if (!isTiqueTaqueAvailable()) return { status: "pulado", detalhe: { skipped: "TiqueTaque não configurado" } };

    const deadline = iniciadoEm + HARD_DEADLINE_MS;
    const cursorRaw = parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10);
    const cursor = Number.isFinite(cursorRaw) && cursorRaw >= 0 ? cursorRaw : 0;
    const date = req.nextUrl.searchParams.get("date") ?? format(brazilDayLabel(-1), "yyyy-MM-dd");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { status: "erro", erros: ["date inválido (use yyyy-MM-dd)."], httpStatus: 400 };
    }

    const companies = await prisma.company.findMany({ select: { id: true }, orderBy: { id: "asc" } });
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

    const employees = await fetchAllEmployees(deadline);
    const employeeByCpf = new Map(employees.map((e) => [e.cpf.replace(/\D/g, ""), e]));

    let created = 0;
    let corrected = 0;
    let processed = 0;
    let semVinculo = 0;
    const errors: string[] = [];

    let i = cursor;
    for (; i < drivers.length; i++) {
      if (Date.now() - iniciadoEm > BATCH_TIME_BUDGET_MS) break;

      const driver = drivers[i];
      const employeeId = employeeByCpf.get(driver.cpf.replace(/\D/g, ""))?.id;
      if (!employeeId) {
        semVinculo++;
        continue;
      }

      if (i > cursor) await sleep(TIQUETAQUE_IMPORT_PACE_MS);

      const result = await importDriverDaysCore(driver.companyId, driver.id, driver.name, employeeId, date, date, deadline);
      created += result.created;
      corrected += result.corrected;
      processed++;
      for (const err of result.errors) errors.push(`${err.driverName}: ${err.message}`);
    }

    const remaining = i < drivers.length;
    if (remaining) encadear({ cursor: String(i), date });

    return {
      status: "ok",
      processados: processed,
      erros: errors,
      continuacao: remaining,
      detalhe: { date, cursorStart: cursor, cursorEnd: i, totalDrivers: drivers.length, semVinculo, created, corrected },
    };
  });
}
