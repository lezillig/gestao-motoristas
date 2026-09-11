import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { isLwAvailable, getLwToken, listarVeiculosLw } from "@/lib/lw/client";
import { matchVehicleToLw } from "@/lib/lw/plateMatch";
import { syncMultasForVehicle, resolveCondutoresPendentes } from "@/lib/lw/sync";
import { sleep } from "@/lib/tiquetaque/pace";

// Agendado no vercel.json pra rodar as 07:45 UTC (depois do Ticket Log,
// ultimo dos 6 crons existentes) -- Multas era a unica das 7 integracoes
// sem sincronizacao automatica, so manual em Integracoes (apontado numa
// auditoria do sistema, 2026-09-11): inconsistente com o padrao que o
// resto do sistema ja segue.
//
// Mesmo motivo/padrao do tiquetaque-import: com pausa de 250ms entre
// veiculos (ver MULTAS_SYNC_PACE_MS em multas/MultasSyncButton.tsx) e uma
// frota de ~200 veiculos, uma unica invocacao estoura o teto de 60s do
// plano Hobby. Auto-encadeia via waitUntil, cursor de onde parou.
export const maxDuration = 60;

const BATCH_TIME_BUDGET_MS = 45_000;
const LW_SYNC_PACE_MS = 250;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isLwAvailable()) {
    return NextResponse.json({ error: "LW Tecnologia não configurada" }, { status: 200 });
  }

  const started = Date.now();
  const cursor = parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10);

  // Cadastro de veiculos da LW e do login (LW_API_LOGIN), nao por empresa —
  // busca uma vez so e reaproveita pro cruzamento de placa de cada empresa,
  // mesmo espirito de prepareMultasSyncPlan (ver lib/lw/sync.ts) mas
  // abrangendo todas as empresas, nao uma so (ali e chamado com sessao de
  // um usuario logado, aqui e o cron, sem sessao).
  let veiculosLw;
  try {
    const token = await getLwToken();
    veiculosLw = await listarVeiculosLw(token);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha ao autenticar na LW." },
      { status: 200 }
    );
  }

  // Lista achatada e ordenada de forma estavel (por empresa, depois por
  // veiculo) pra o cursor de uma invocacao encadeada continuar exatamente
  // de onde a anterior parou, mesmo buscando o dado de novo do banco a
  // cada invocacao — mesmo padrao do tiquetaque-import.
  const companies = await prisma.company.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  const itens: { companyId: string; vehicleId: string; placaParaConsulta: string }[] = [];
  const semCorrespondencia: string[] = [];
  for (const company of companies) {
    const vehicles = await prisma.vehicle.findMany({
      where: { companyId: company.id },
      select: { id: true, plate: true },
      orderBy: { id: "asc" },
    });
    for (const vehicle of vehicles) {
      const match = matchVehicleToLw(vehicle.plate, veiculosLw);
      if (!match) {
        semCorrespondencia.push(vehicle.plate);
        continue;
      }
      itens.push({ companyId: company.id, vehicleId: vehicle.id, placaParaConsulta: match.placaParaConsulta });
    }
  }

  let criadas = 0;
  let atualizadas = 0;
  let processed = 0;
  const errors: string[] = [];

  let i = cursor;
  for (; i < itens.length; i++) {
    if (Date.now() - started > BATCH_TIME_BUDGET_MS) break;

    const item = itens[i];
    if (i > cursor) await sleep(LW_SYNC_PACE_MS);

    try {
      const result = await syncMultasForVehicle(item.companyId, item.vehicleId, item.placaParaConsulta);
      await resolveCondutoresPendentes(item.companyId, item.vehicleId);
      criadas += result.criadas;
      atualizadas += result.atualizadas;
      processed++;
    } catch (e) {
      errors.push(`${item.placaParaConsulta}: ${e instanceof Error ? e.message : "erro desconhecido"}`);
    }
  }

  const remaining = i < itens.length;
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
    cursorStart: cursor,
    cursorEnd: i,
    totalVeiculos: itens.length,
    processed,
    criadas,
    atualizadas,
    semCorrespondencia: cursor === 0 ? semCorrespondencia.length : undefined,
    errors,
    continued: remaining,
  });
}
