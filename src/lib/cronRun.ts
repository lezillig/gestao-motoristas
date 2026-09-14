import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";

// Moldura comum dos crons: autenticacao pelo CRON_SECRET, registro da
// execucao em CronExecucao (status, contagens, erros, duracao) e codigo HTTP
// honesto (500 quando nada foi processado e houve erro) — antes cada rota
// devolvia { error } com 200 e a falha ficava invisivel no painel da Vercel.
// Tambem centraliza o auto-encadeamento (waitUntil + fetch na propria rota):
// se a chamada seguinte falhar, fica registrado como "encadeamento_falhou"
// em vez de sumir num catch vazio.

export type CronStatus = "ok" | "parcial" | "erro" | "pulado" | "encadeamento_falhou";

export type CronResultado = {
  status: CronStatus;
  processados?: number;
  erros?: string[];
  continuacao?: boolean;
  detalhe?: Record<string, unknown>;
  httpStatus?: number;
};

export type CronContexto = {
  req: NextRequest;
  iniciadoEm: number;
  // Dispara a proxima invocacao desta mesma rota (mesmo segredo) com os
  // parametros informados, sem bloquear a resposta atual.
  encadear: (params: Record<string, string>) => void;
};

export const CRON_JOBS = [
  "tiquetaque-timesheets",
  "tiquetaque-import",
  "siat-import",
  "ituran-import",
  "sofit-import",
  "sofit-cnh-import",
  "sofit-manutencao",
  "ticketlog-import",
  "lw-multas-import",
  "hoje-email",
] as const;
export type CronJob = (typeof CRON_JOBS)[number];

export const CRON_JOB_LABEL: Record<CronJob, string> = {
  "tiquetaque-timesheets": "TiqueTaque — espelho mensal",
  "tiquetaque-import": "TiqueTaque — ponto D-1",
  "siat-import": "SIAT — escalas D-1",
  "ituran-import": "Ituran — viagens e leituras D-1",
  "sofit-import": "Sofit — combustível",
  "sofit-cnh-import": "Sofit — CNH dos motoristas",
  "sofit-manutencao": "Sofit — manutenção (OS e veículos)",
  "ticketlog-import": "Ticket Log — cartões",
  "lw-multas-import": "LW — multas",
  "hoje-email": "E-mail do painel Hoje",
};

const RETENCAO_DIAS = 60;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function registrar(job: CronJob, iniciadoEm: number, r: CronResultado): Promise<void> {
  try {
    await prisma.cronExecucao.create({
      data: {
        job,
        iniciadoEm: new Date(iniciadoEm),
        duracaoMs: Date.now() - iniciadoEm,
        status: r.status,
        processados: r.processados ?? 0,
        continuacao: r.continuacao ?? false,
        erros: r.erros && r.erros.length > 0 ? r.erros.slice(0, 50) : undefined,
        detalhe: r.detalhe ? JSON.parse(JSON.stringify(r.detalhe)) : undefined,
      },
    });
    // Limpeza esporadica (1 em 20) do historico antigo e das janelas de rate
    // limit ja vencidas — sem cron dedicado.
    if (Math.random() < 0.05) {
      const corte = new Date(Date.now() - RETENCAO_DIAS * 86_400_000);
      await Promise.all([
        prisma.cronExecucao.deleteMany({ where: { finalizadoEm: { lt: corte } } }),
        prisma.rateLimit.deleteMany({ where: { reiniciaEm: { lt: new Date() } } }),
      ]);
    }
  } catch (e) {
    console.error(`[cron ${job}] falha ao registrar execução`, e instanceof Error ? e.message : e);
  }
}

export async function executarCron(job: CronJob, req: NextRequest, fn: (ctx: CronContexto) => Promise<CronResultado>): Promise<NextResponse> {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const iniciadoEm = Date.now();
  const encadeamentos: Promise<void>[] = [];

  const encadear = (params: Record<string, string>) => {
    const nextUrl = new URL(req.nextUrl.pathname, process.env.APP_BASE_URL ?? req.nextUrl.origin);
    for (const [k, v] of Object.entries(params)) nextUrl.searchParams.set(k, v);
    const p = fetch(nextUrl.toString(), { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })
      .catch(async (e) => {
        await registrar(job, Date.now(), {
          status: "encadeamento_falhou",
          erros: [`Continuação não disparou: ${e instanceof Error ? e.message : "falha de rede"}`],
          detalhe: { params },
        });
      });
    encadeamentos.push(p);
    waitUntil(p);
  };

  let resultado: CronResultado;
  try {
    resultado = await fn({ req, iniciadoEm, encadear });
  } catch (e) {
    resultado = { status: "erro", erros: [e instanceof Error ? e.message : "falha desconhecida"] };
  }

  const erros = resultado.erros ?? [];
  // Falhou de verdade so quando nada foi processado E houve erro; erro em
  // parte dos itens e "parcial" (o restante entrou), pra nao esconder o que
  // deu certo nem o que deu errado.
  const status: CronStatus =
    resultado.status === "erro" || resultado.status === "pulado" || resultado.status === "encadeamento_falhou"
      ? resultado.status
      : erros.length > 0
        ? (resultado.processados ?? 0) > 0
          ? "parcial"
          : "erro"
        : resultado.status;
  const final: CronResultado = { ...resultado, status, erros };
  await registrar(job, iniciadoEm, final);

  const httpStatus = final.httpStatus ?? (status === "erro" ? 500 : 200);
  return NextResponse.json(
    { job, status, processados: final.processados ?? 0, continued: final.continuacao ?? false, errors: erros, ...(final.detalhe ?? {}) },
    { status: httpStatus }
  );
}

export type UltimaExecucao = {
  job: CronJob;
  label: string;
  ultima: { finalizadoEm: Date; status: CronStatus; processados: number; duracaoMs: number; erros: string[]; continuacao: boolean } | null;
  falhasUltimas24h: number;
};

// Ultima execucao de cada job + quantas falhas nas ultimas 24h — pro painel
// de Integrações. Le uma janela recente e reduz em memoria (tabela pequena,
// 10 jobs x poucas execucoes/dia).
export async function ultimasExecucoesCron(): Promise<UltimaExecucao[]> {
  const desde = new Date(Date.now() - 7 * 86_400_000);
  const rows = await prisma.cronExecucao.findMany({
    where: { finalizadoEm: { gte: desde } },
    orderBy: { finalizadoEm: "desc" },
    take: 500,
    select: { job: true, finalizadoEm: true, status: true, processados: true, duracaoMs: true, erros: true, continuacao: true },
  });
  const corte24h = Date.now() - 86_400_000;
  return CRON_JOBS.map((job) => {
    const doJob = rows.filter((r) => r.job === job);
    const u = doJob[0];
    return {
      job,
      label: CRON_JOB_LABEL[job],
      ultima: u
        ? {
            finalizadoEm: u.finalizadoEm,
            status: u.status as CronStatus,
            processados: u.processados,
            duracaoMs: u.duracaoMs,
            erros: Array.isArray(u.erros) ? (u.erros as string[]) : [],
            continuacao: u.continuacao,
          }
        : null,
      falhasUltimas24h: doJob.filter((r) => r.finalizadoEm.getTime() >= corte24h && (r.status === "erro" || r.status === "encadeamento_falhou")).length,
    };
  });
}
