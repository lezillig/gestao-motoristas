import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { isSofitConfigured } from "@/lib/sofit/config";
import { runSofitSync, ultimoSyncComSucesso } from "@/lib/sofit/importCore";
import { SOFIT_ENTITIES, type SofitEntity } from "@/lib/sofit/types";

// Sincronizacao diaria com o Sofit, agendada no vercel.json as 06:00 UTC
// (= 03:00 de Brasilia — uma hora depois do cron do TiqueTaque, pra os dois
// nao disputarem a mesma janela de execucao).
//
// Mesma restricao de plataforma ja documentada na rota do TiqueTaque: plano
// Hobby da Vercel, 60s de teto duro por invocacao. Aqui o encadeamento e por
// EMPRESA (nao por motorista): cada invocacao processa quantas empresas
// couberem no orcamento e, se sobrar, dispara — via waitUntil, garantindo
// que a chamada saia antes da instancia congelar — uma nova invocacao de si
// mesma com o cursor de onde parou.
export const maxDuration = 60;

const BATCH_TIME_BUDGET_MS = 40_000;
const HARD_DEADLINE_MS = 50_000;

// Quanto historico buscar quando a empresa nunca sincronizou aquela entidade
// com sucesso. 30 dias cobre o mes corrente sem transformar a primeira
// execucao numa carga de anos (que estouraria o teto de tempo) — o
// historico completo se faz pela tela, em janelas.
const PRIMEIRA_CARGA_DIAS = 30;
// Reprocessa alguns dias ja sincronizados a cada execucao: lancamento
// retroativo no Sofit (abastecimento digitado dias depois) e comum, e a
// deduplicacao por codigo do Sofit torna reprocessar barato e seguro.
const SOBREPOSICAO_DIAS = 3;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSofitConfigured()) {
    return NextResponse.json({ error: "Sofit não configurado" }, { status: 200 });
  }

  const started = Date.now();
  const deadline = started + HARD_DEADLINE_MS;
  const cursor = Number.parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10) || 0;

  // Ordem estavel (por id) pra o cursor de uma invocacao encadeada continuar
  // exatamente de onde a anterior parou — mesmo padrao do cron do TiqueTaque.
  const companies = await prisma.company.findMany({
    where: { active: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  const resumo: {
    companyId: string;
    entidade: SofitEntity;
    lidos: number;
    criados: number;
    atualizados: number;
    erros: number;
  }[] = [];

  let i = cursor;
  let semOrcamento = false;
  for (; i < companies.length; i++) {
    if (Date.now() - started > BATCH_TIME_BUDGET_MS) break;

    const companyId = companies[i].id;
    const agora = new Date();

    // Uma entidade de cada vez, cada uma com sua propria janela incremental:
    // abastecimento pode estar em dia e manutencao atrasada (ou vice-versa),
    // e uma falha isolada nao pode fazer as outras reimportarem tudo.
    for (const entidade of SOFIT_ENTITIES) {
      if (Date.now() - started > BATCH_TIME_BUDGET_MS) {
        semOrcamento = true;
        break;
      }

      const ultimo = entidade === "VEICULOS" ? null : await ultimoSyncComSucesso(companyId, entidade);
      const start = ultimo
        ? new Date(ultimo.getTime() - SOBREPOSICAO_DIAS * 86_400_000)
        : new Date(agora.getTime() - PRIMEIRA_CARGA_DIAS * 86_400_000);

      const [result] = await runSofitSync(companyId, {
        entidades: [entidade],
        period: { start, end: agora },
        origem: "CRON",
        deadline,
      });

      resumo.push({
        companyId,
        entidade,
        lidos: result.lidos,
        criados: result.criados,
        atualizados: result.atualizados,
        erros: result.erros.length,
      });
    }

    // Orcamento acabou no MEIO desta empresa: para com o cursor apontando
    // pra ela (nao pra proxima), pra invocacao encadeada retomar as
    // entidades que faltaram. As ja processadas serao refeitas — barato e
    // seguro, porque cada entidade e incremental (busca desde o ultimo
    // sucesso) e idempotente.
    if (semOrcamento) break;
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
    cursorStart: cursor,
    cursorEnd: i,
    totalEmpresas: companies.length,
    resumo,
    continued: remaining,
  });
}
