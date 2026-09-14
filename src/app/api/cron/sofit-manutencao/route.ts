import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { isSofitAvailable } from "@/lib/sofit/client";
import { prisma } from "@/lib/prisma";
import { atualizarUltimaManutencao, syncOrdensServicoSofit, syncVeiculosSofit, ultimoCursorOs } from "@/lib/sofit/manutencaoSync";

// Espelho de manutencao da Sofit (OS, frota, vencimentos). 06:40 UTC =
// 03:40 BRT, entre o cron da Ituran (06:00) e o de combustivel da Sofit
// (07:00). Auto-encadeado por cursor `since` (teto de 60s do Hobby):
// a diaria e 1 invocacao; a carga inicial, 2-3.
export const maxDuration = 60;
const BUDGET_MS = 40_000;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSofitAvailable()) return NextResponse.json({ error: "Sofit não configurada" }, { status: 200 });

  const deadline = Date.now() + BUDGET_MS;
  const sinceParam = req.nextUrl.searchParams.get("since");
  const companyParam = req.nextUrl.searchParams.get("company");
  const companies = await prisma.company.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  const out: Record<string, unknown>[] = [];

  for (const company of companies) {
    if (companyParam && company.id !== companyParam) continue;
    try {
      const veiculos = sinceParam ? undefined : await syncVeiculosSofit(company.id, deadline);
      const sinceDate = sinceParam ? new Date(sinceParam) : null;
      if (sinceDate && Number.isNaN(sinceDate.getTime())) {
        return NextResponse.json({ error: "since inválido (use ISO 8601)." }, { status: 400 });
      }
      const since = sinceDate ?? (await ultimoCursorOs(company.id));
      const r = await syncOrdensServicoSofit(company.id, since, deadline);
      let ultima: number | undefined;
      if (r.hasMore) {
        const nextUrl = new URL(req.nextUrl.pathname, process.env.APP_BASE_URL ?? req.nextUrl.origin);
        nextUrl.searchParams.set("since", r.nextSince.toISOString());
        nextUrl.searchParams.set("company", company.id);
        waitUntil(fetch(nextUrl.toString(), { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {}));
      } else {
        ultima = await atualizarUltimaManutencao(company.id);
      }
      out.push({ company: company.id, veiculos, osUpserted: r.upserted, osSemVeiculo: r.semVeiculo, continued: r.hasMore, ultimaManutencaoAtualizada: ultima });
    } catch (e) {
      out.push({ company: company.id, error: e instanceof Error ? e.message : "falha" });
    }
  }
  return NextResponse.json({ results: out });
}
