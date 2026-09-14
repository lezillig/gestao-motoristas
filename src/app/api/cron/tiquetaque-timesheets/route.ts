import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { format, subMonths } from "date-fns";
import { prisma } from "@/lib/prisma";
import { fetchAllEmployees, isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import { sleep, TIQUETAQUE_IMPORT_PACE_MS } from "@/lib/tiquetaque/pace";
import { importTimesheetCore } from "@/lib/tiquetaque/timesheetCore";
import { brazilDayLabel } from "@/lib/date";

// Espelho de ponto mensal (TiqueTaque /timesheets) pra todo motorista ativo.
// Agendado as 04:20 UTC (01:20 BRT) — ANTES do cron de ponto das 05:00 UTC,
// de proposito: os dois pagam 1 chamada por motorista no mesmo limite de
// 60 req/min do TiqueTaque, entao nao podem se sobrepor. Sempre o mes
// corrente; ate o dia 5 tambem o mes anterior (fechamento/ajustes). Mesmo
// auto-encadeamento por cursor do tiquetaque-import (teto de 60s do Hobby).
export const maxDuration = 60;

const BATCH_TIME_BUDGET_MS = 45_000;
const HARD_DEADLINE_MS = 50_000;
const DIAS_PARA_REVISAR_MES_ANTERIOR = 5;

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
  const deadline = started + HARD_DEADLINE_MS;
  const cursor = parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10);

  const hoje = brazilDayLabel(0);
  const mesesParam = req.nextUrl.searchParams.get("meses");
  const meses = mesesParam
    ? mesesParam.split(",").filter((m) => /^\d{4}-\d{2}$/.test(m))
    : [format(hoje, "yyyy-MM"), ...(hoje.getDate() <= DIAS_PARA_REVISAR_MES_ANTERIOR ? [format(subMonths(hoje, 1), "yyyy-MM")] : [])];

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
  // Lista achatada motorista x mes, ordem estavel pro cursor encadeado.
  const itens = drivers.flatMap((d) => meses.map((mes) => ({ ...d, mes })));

  let employees;
  try {
    employees = await fetchAllEmployees(deadline);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Falha ao buscar funcionários do TiqueTaque." }, { status: 200 });
  }
  const employeeByCpf = new Map(employees.map((e) => [e.cpf.replace(/\D/g, ""), e]));

  let processed = 0;
  let semVinculo = 0;
  const errors: string[] = [];
  let i = cursor;
  for (; i < itens.length; i++) {
    if (Date.now() - started > BATCH_TIME_BUDGET_MS) break;
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
  if (remaining) {
    const nextUrl = new URL(req.nextUrl.pathname, process.env.APP_BASE_URL ?? req.nextUrl.origin);
    nextUrl.searchParams.set("cursor", String(i));
    nextUrl.searchParams.set("meses", meses.join(","));
    waitUntil(fetch(nextUrl.toString(), { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {}));
  }

  return NextResponse.json({ meses, cursorStart: cursor, cursorEnd: i, total: itens.length, processed, semVinculo, errors, continued: remaining });
}
