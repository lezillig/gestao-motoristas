import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCobliAvailable } from "@/lib/cobli/client";
import { syncTelemetryCore } from "@/lib/telemetry/sync";

// Sincronizacao automatica da telemetria da Cobli: puxa a ultima posicao
// conhecida de cada rastreador e grava uma leitura por veiculo do cadastro
// (ver src/lib/telemetry/sync.ts — leitura repetida do mesmo instante nao
// duplica).
//
// Agendada no vercel.json as 06:00 UTC (03:00 de Brasilia). O plano Hobby da
// Vercel so permite UMA execucao diaria por cron, e uma foto por dia da
// posicao e pouco pra ranking de velocidade — por isso a rota aceita ser
// chamada por qualquer agendador externo (mesmo header de autorizacao), na
// frequencia que a operacao quiser. Cada chamada e independente e barata:
// uma requisicao a Cobli por empresa.
export const maxDuration = 60;

// Teto de tempo desta invocacao — mais apertado que os 60s duros da Vercel,
// pra sobrar folga pra devolver o resultado do que ja foi sincronizado em
// vez de morrer com "Task timed out" (licao da integracao do TiqueTaque).
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
  if (!isCobliAvailable()) {
    return NextResponse.json({ error: "Cobli não configurada (COBLI_API_KEY ausente)." }, { status: 200 });
  }

  const deadline = Date.now() + HARD_DEADLINE_MS;
  const companies = await prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  const resultados = [];
  const errors: string[] = [];
  for (const company of companies) {
    // Sem orcamento de tempo pra mais uma empresa: para e devolve o que deu
    // — a proxima execucao pega as que ficaram (nada aqui depende de ordem
    // nem acumula estado entre empresas).
    if (Date.now() >= deadline) {
      errors.push("Tempo de execução esgotado antes de sincronizar todas as empresas.");
      break;
    }
    try {
      const result = await syncTelemetryCore(company.id, deadline);
      resultados.push({
        empresa: company.name,
        criadas: result.criadas,
        jaExistentes: result.jaExistentes,
        vinculosCriados: result.vinculosCriados,
        semVinculo: result.semVinculo.length,
      });
    } catch (e) {
      errors.push(`${company.name}: ${e instanceof Error ? e.message : "falha ao sincronizar com a Cobli."}`);
    }
  }

  return NextResponse.json({ empresas: resultados, errors });
}
