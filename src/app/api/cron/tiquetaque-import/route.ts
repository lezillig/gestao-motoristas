import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { format, subDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { fetchAllEmployees, isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import { sleep, TIQUETAQUE_IMPORT_PACE_MS } from "@/lib/tiquetaque/pace";
import { importDriverDaysCore } from "@/lib/tiquetaque/importCore";

// Agendado no vercel.json pra rodar as 05:00 UTC (= 02:00 horario de
// Brasilia, sem risco de virada de dia entre os dois fusos nesse horario
// especifico — 02:00 BRT + 3h = 05:00 UTC, sem cruzar meia-noite). Busca as
// batidas de ONTEM (D-1) pra todo motorista/funcionario ja cadastrado, pra
// manter o sistema sempre com o dia anterior atualizado sem precisar de
// importacao manual.
//
// O plano Vercel deste projeto e Hobby: 60s de teto rigido por execucao,
// sem excecao. Uma unica chamada processando os ~70+ funcionarios em
// sequencia (pace de 1.1s cada, ver TIQUETAQUE_IMPORT_PACE_MS — limite real
// da API do TiqueTaque, nao da pra reduzir) estoura esse teto. Por isso a
// rota se auto-encadeia: processa o quanto der dentro de um orcamento de
// tempo seguro e, se sobrar gente, dispara — via waitUntil, que garante que
// a chamada saia antes da instancia congelar — uma NOVA invocacao de si
// mesma com o cursor de onde parou. Cada invocacao encadeada tem seu proprio
// teto de 60s do zero, entao qualquer quantidade de funcionarios e coberta,
// so muda quantas invocacoes encadeadas acontecem.
export const maxDuration = 60;

const BATCH_TIME_BUDGET_MS = 45_000;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isTiqueTaqueAvailable()) {
    return NextResponse.json({ error: "TiqueTaque não configurado" }, { status: 200 });
  }

  const started = Date.now();
  const cursor = parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10);
  const date = req.nextUrl.searchParams.get("date") ?? format(subDays(new Date(), 1), "yyyy-MM-dd");

  // Lista achatada e ordenada de forma estavel (por empresa, depois por id)
  // pra o cursor de uma invocacao encadeada continuar exatamente de onde a
  // anterior parou, mesmo buscando o dado de novo do banco a cada invocacao.
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

  let employees;
  try {
    employees = await fetchAllEmployees();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha ao buscar funcionários do TiqueTaque." },
      { status: 200 }
    );
  }
  const employeeByCpf = new Map(employees.map((e) => [e.cpf.replace(/\D/g, ""), e]));

  let created = 0;
  let corrected = 0;
  let processed = 0;
  let semVinculo = 0;
  const errors: string[] = [];

  let i = cursor;
  for (; i < drivers.length; i++) {
    if (Date.now() - started > BATCH_TIME_BUDGET_MS) break;

    const driver = drivers[i];
    const employeeId = employeeByCpf.get(driver.cpf.replace(/\D/g, ""))?.id;
    if (!employeeId) {
      semVinculo++;
      continue;
    }

    if (i > cursor) await sleep(TIQUETAQUE_IMPORT_PACE_MS);

    const result = await importDriverDaysCore(driver.companyId, driver.id, driver.name, employeeId, date, date);
    created += result.created;
    corrected += result.corrected;
    processed++;
    for (const err of result.errors) errors.push(`${err.driverName}: ${err.message}`);
  }

  const remaining = i < drivers.length;
  if (remaining) {
    const nextUrl = new URL(req.nextUrl.pathname, req.nextUrl.origin);
    nextUrl.searchParams.set("cursor", String(i));
    nextUrl.searchParams.set("date", date);
    waitUntil(
      fetch(nextUrl.toString(), {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      }).catch(() => {})
    );
  }

  return NextResponse.json({
    date,
    cursorStart: cursor,
    cursorEnd: i,
    totalDrivers: drivers.length,
    processed,
    semVinculo,
    created,
    corrected,
    errors,
    continued: remaining,
  });
}
