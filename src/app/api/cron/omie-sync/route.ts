import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isOmieAvailable } from "@/lib/omie/client";
import { syncClientesOmie, syncTitulosOmie, type SyncResultado } from "@/lib/omie/sync";

// Sincronização automática com o Omie, agendada no vercel.json.
//
// Roda às 06:00 UTC (03:00 de Brasília), uma hora depois da importação do
// TiqueTaque, de propósito: as duas rotas de cron no plano Hobby competem pelo
// mesmo teto de execução e não há motivo pra disputarem a mesma janela.
//
// Ordem importa: clientes primeiro, títulos depois. O método de listagem de
// títulos devolve só o CÓDIGO do cliente, e é o cadastro de clientes já
// sincronizado que resolve esse código para um cliente daqui — invertida, a
// primeira execução deixaria todo título sem vínculo (ver dadosDoTitulo em
// src/lib/omie/sync.ts).
export const maxDuration = 60;

// Teto de tempo por recurso. Diferente da rota do TiqueTaque, esta NÃO se
// auto-encadeia: o sync do Omie é idempotente e a janela padrão é curta
// (últimos 45 dias), então uma execução que não terminou simplesmente termina
// na noite seguinte — e encadear invocações multiplicaria chamadas a uma API
// que pune repetição com bloqueio de 30 minutos (ver src/lib/omie/pace.ts).
// Quando isso acontece, a execução fica marcada como parcial no OmieSyncLog e
// aparece como "parcial" na tela de integrações.
const ORCAMENTO_TOTAL_MS = 50_000;

// Janela de vencimento sincronizada a cada execução. Não é só "hoje": título
// vencido é renegociado, baixado e cancelado no ERP depois do vencimento, e
// uma janela retroativa faz o espelho acompanhar essas mudanças sem precisar
// de sync manual. 15 dias à frente cobrem o que está por vencer.
const DIAS_RETROATIVOS = 45;
const DIAS_FUTUROS = 15;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function resumo(resultado: SyncResultado) {
  return {
    criados: resultado.criados,
    atualizados: resultado.atualizados,
    ignorados: resultado.ignorados,
    paginasLidas: resultado.paginasLidas,
    parcial: resultado.interrompidoPorTempo,
    erro: resultado.erro,
  };
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isOmieAvailable()) {
    return NextResponse.json({ error: "Omie não configurado" }, { status: 200 });
  }

  const deadline = Date.now() + ORCAMENTO_TOTAL_MS;
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - DIAS_RETROATIVOS, 12);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + DIAS_FUTUROS, 12);

  // Uma única App Key por instalação (variáveis de ambiente), então todas as
  // empresas ativas são sincronizadas contra a MESMA conta Omie. Hoje isso
  // basta — o sistema roda com uma empresa só — mas é o ponto a mudar primeiro
  // se um segundo tenant com Omie próprio aparecer: as credenciais teriam que
  // sair do ambiente e virar cadastro por Company.
  const companies = await prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  const execucoes: Record<string, unknown>[] = [];

  // Erro numa chamada quase sempre significa bloqueio por consumo indevido, e
  // esse bloqueio é da App Key — vale pra qualquer empresa e qualquer recurso
  // seguinte nesta invocação. Insistir depois dele só estende o bloqueio (ver
  // src/lib/omie/pace.ts), então a execução inteira para no primeiro erro.
  let abortado = false;

  for (const company of companies) {
    if (abortado || Date.now() >= deadline) break;

    const clientes = await syncClientesOmie(company.id, {
      origem: "CRON",
      deadline,
      // Nunca cria cliente sozinho no automático: criar cadastro sem ninguém
      // olhando é como o cadastro de centros de custo vira lixo. Criação só
      // pela tela, com o operador ligando a opção explicitamente.
      criarNovos: false,
    });
    execucoes.push({ empresa: company.name, recurso: "CLIENTES", ...resumo(clientes) });
    if (clientes.erro) {
      abortado = true;
      break;
    }

    for (const tipo of ["RECEBER", "PAGAR"] as const) {
      if (Date.now() >= deadline) break;
      const titulos = await syncTitulosOmie(company.id, tipo, { inicio, fim }, { origem: "CRON", deadline });
      execucoes.push({ empresa: company.name, recurso: `CONTAS_${tipo}`, ...resumo(titulos) });
      if (titulos.erro) {
        abortado = true;
        break;
      }
    }
  }

  return NextResponse.json({
    periodo: { inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) },
    empresas: companies.length,
    abortado,
    execucoes,
  });
}
