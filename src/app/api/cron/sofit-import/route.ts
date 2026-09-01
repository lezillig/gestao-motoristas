import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { isSofitAvailable } from "@/lib/sofit/client";
import { syncSofitFuelCore } from "@/app/(app)/combustivel/sofitActions";

// Diario, retomando sempre da ultima transacao Sofit ja importada (ver
// syncSofitFuelCore). Um backfill grande (ex.: desde 2026-01-01 numa conta
// nunca sincronizada) pode nao caber num unico teto de 60s — por isso a
// rota se auto-encadeia (mesmo padrao do cron do TiqueTaque): se sobrar
// periodo pra buscar quando o orcamento de tempo acaba, dispara — via
// waitUntil, que garante o fetch sair antes da instancia congelar — uma
// nova invocacao de si mesma. Sem cursor explicito: o proprio `since`
// (derivado da ultima transacao ja importada no banco) e o estado
// persistido entre invocacoes.
export const maxDuration = 60;

const BATCH_DEADLINE_MS = 45_000;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSofitAvailable()) {
    return NextResponse.json({ error: "Sofit não configurado" }, { status: 200 });
  }

  const deadline = Date.now() + BATCH_DEADLINE_MS;
  const companies = await prisma.company.findMany({ select: { id: true } });

  const results = [];
  let anyMore = false;
  for (const company of companies) {
    const result = await syncSofitFuelCore(company.id, deadline);
    results.push({ companyId: company.id, ...result });
    if (result.hasMore) anyMore = true;
  }

  if (anyMore) {
    const nextUrl = new URL(req.nextUrl.pathname, req.nextUrl.origin);
    waitUntil(
      fetch(nextUrl.toString(), {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      }).catch(() => {})
    );
  }

  return NextResponse.json({ results, continued: anyMore });
}
