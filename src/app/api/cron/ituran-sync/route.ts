import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { isIturanConfigured } from "@/lib/ituran/config";
import { getActiveTelemetryProvider } from "@/lib/telemetry";
import { syncTelemetryForCompany, type TelemetrySyncResult } from "@/lib/telemetry/sync";

// Sincronismo automático das posições da Ituran, agendado no vercel.json.
// Busca incremental: cada empresa parte da última leitura já gravada (ver
// syncTelemetryForCompany), então a rota pode rodar quantas vezes quiser sem
// duplicar nada.
//
// Mesmo teto de 60s por invocação do plano Hobby da Vercel que a importação
// do TiqueTaque enfrenta: processa empresas dentro de um orçamento de tempo
// seguro e, se sobrar empresa, encadeia uma nova invocação de si mesma —
// via waitUntil, que garante que a chamada saia antes da instância congelar.
export const maxDuration = 60;

const BATCH_TIME_BUDGET_MS = 45_000;
const HARD_DEADLINE_MS = 50_000;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Sem credenciais o provedor ativo é o simulado, e um cron gravando dado
  // de demonstração no banco de produção seria pior que não rodar.
  if (!isIturanConfigured()) {
    return NextResponse.json({ error: "Ituran não configurada — sincronismo ignorado." }, { status: 200 });
  }

  const started = Date.now();
  const deadline = started + HARD_DEADLINE_MS;
  const cursor = parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10);

  // Ordem estável por id para o cursor de uma invocação encadeada continuar
  // exatamente de onde a anterior parou.
  const companies = await prisma.company.findMany({ select: { id: true }, orderBy: { id: "asc" } });

  // Uma instância só de provedor para todas as empresas: o token de sessão
  // fica em cache no cliente e não se paga um login por empresa.
  const provider = getActiveTelemetryProvider();

  const results: (TelemetrySyncResult & { companyId: string })[] = [];
  const errors: string[] = [];

  let i = cursor;
  for (; i < companies.length; i++) {
    if (Date.now() - started > BATCH_TIME_BUDGET_MS) break;
    const company = companies[i];
    try {
      const result = await syncTelemetryForCompany(company.id, { provider, deadline });
      results.push({ companyId: company.id, ...result });
    } catch (e) {
      errors.push(`${company.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const remaining = i < companies.length;
  if (remaining) {
    const nextUrl = new URL(req.nextUrl.pathname, req.nextUrl.origin);
    nextUrl.searchParams.set("cursor", String(i));
    waitUntil(
      fetch(nextUrl.toString(), {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      }).catch(() => {})
    );
  }

  return NextResponse.json({
    provider: provider.name,
    cursorStart: cursor,
    cursorEnd: i,
    totalCompanies: companies.length,
    created: results.reduce((sum, r) => sum + r.created, 0),
    duplicates: results.reduce((sum, r) => sum + r.duplicates, 0),
    speeding: results.reduce((sum, r) => sum + r.speeding, 0),
    unknownPlates: [...new Set(results.flatMap((r) => r.unknownPlates))],
    errors,
    continued: remaining,
  });
}
