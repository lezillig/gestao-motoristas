import type { OmieSyncRun } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOmieAvailable } from "@/lib/omie/client";
import { executarFase, FASES, proximaFase, type FaseSync } from "@/lib/omie/sync";
import { carregarContexto, garantirConfig } from "./contexto";
import { executarAuditoria } from "./engine";
import { gerarEEnviarRelatorio } from "./relatorio";
import { fimDoDia, inicioDoDia, inicioDoMes, somarDias } from "./periodos";

// CICLO DIÁRIO DA CONTROLADORIA
//
// Máquina de estados que leva o modulo de "nada" a "relatorio no e-mail":
//
//   cadastros -> titulos -> movimentos -> notas -> auditoria -> relatorio
//
// Roda em passos porque o cron da Vercel no plano Hobby tem 60s de teto duro
// por invocacao — a mesma restricao que ja moldou o import do TiqueTaque neste
// projeto. Cada chamada de executarPasso() faz o que cabe no orcamento, grava
// onde parou em OmieSyncRun (fase + cursor) e devolve se ainda ha trabalho. Um
// unico ponto de entrada serve ao cron (que se auto-encadeia) e ao botao
// "sincronizar agora" da UI (que chama em laco ate acabar ou o tempo estourar).
//
// A CARGA HISTORICA (backfill) usa a mesma maquina, mes a mes, sem gerar
// relatorio: sao dezenas de janelas mensais desde 01/01/2025, e disparar um
// e-mail por mes carregado seria absurdo. Só o ciclo diario, ao terminar,
// escreve e envia o relatorio do dia.

// Fases que rodam DEPOIS da sincronizacao, no ciclo diario (o backfill nao
// passa por elas — ver obterOuCriarRun).
export type FasePosSync = "auditoria" | "relatorio";
export type FaseCiclo = FaseSync | FasePosSync | "concluido";

export type ResultadoPasso = {
  runId: string;
  fase: FaseCiclo;
  backfill: boolean;
  janela: { inicio: Date; fim: Date };
  concluido: boolean;
  // Ainda ha trabalho: o chamador deve invocar de novo (encadeando ou em laco).
  continua: boolean;
  detalhes: string[];
};

export async function executarPasso(params: {
  companyId: string;
  // Timestamp absoluto ate onde este passo pode trabalhar.
  fimDoOrcamento: number;
  // Teto duro da invocacao (mais folgado), repassado ao cliente HTTP.
  deadline: number;
  // Data de referencia do ciclo diario (D-1). So usada quando nao ha backfill
  // pendente.
  dataReferencia: Date;
}): Promise<ResultadoPasso> {
  const { companyId, fimDoOrcamento, deadline, dataReferencia } = params;
  const config = await garantirConfig(companyId);

  const run = await obterOuCriarRun(companyId, dataReferencia, config.dataInicioBase);
  const detalhes: string[] = [];

  const fase = run.fase as FaseCiclo;

  // ---- Fases de sincronização ----
  if ((FASES as readonly string[]).includes(fase)) {
    const resultado = await executarFase(
      fase as FaseSync,
      {
        companyId,
        cursor: run.cursor,
        janelaInicio: run.janelaInicio,
        janelaFim: run.janelaFim,
        fimDoOrcamento,
        deadline,
      },
      run.backfill
    );

    const proxima = resultado.faseConcluida ? proximaFase(fase as FaseSync) : null;
    // Fim das fases de sync: o backfill encerra aqui (nao audita nem envia
    // e-mail); o ciclo diario segue para auditoria.
    const novaFase: FaseCiclo = resultado.faseConcluida
      ? proxima ?? (run.backfill ? "concluido" : "auditoria")
      : (fase as FaseCiclo);

    const atualizado = await prisma.omieSyncRun.update({
      where: { id: run.id },
      data: {
        fase: novaFase,
        cursor: resultado.proximoCursor,
        invocacoes: { increment: 1 },
        cadastros: { increment: resultado.cadastros },
        titulosPagar: { increment: resultado.titulosPagar },
        titulosReceber: { increment: resultado.titulosReceber },
        baixas: { increment: resultado.baixas },
        movimentos: { increment: resultado.movimentos },
        notas: { increment: resultado.notas },
        ...(resultado.erros.length > 0
          ? { erro: [run.erro, ...resultado.erros].filter(Boolean).join(" | ").slice(0, 2000) }
          : {}),
        ...(novaFase === "concluido"
          ? { status: "CONCLUIDO" as const, finalizadoEm: new Date() }
          : {}),
      },
    });

    detalhes.push(
      `Fase ${fase}: ${resultado.titulosPagar} títulos a pagar, ${resultado.titulosReceber} a receber, ` +
        `${resultado.baixas} baixas, ${resultado.movimentos} movimentos, ${resultado.notas} notas, ` +
        `${resultado.cadastros} cadastros.`
    );
    for (const erro of resultado.erros) detalhes.push(`Erro: ${erro}`);

    return {
      runId: run.id,
      fase: novaFase,
      backfill: run.backfill,
      janela: { inicio: run.janelaInicio, fim: run.janelaFim },
      concluido: atualizado.status === "CONCLUIDO",
      // Backfill concluido ainda "continua": ha o proximo mes (ou o ciclo
      // diario) esperando, e quem decide isso e obterOuCriarRun na proxima
      // chamada.
      continua: novaFase !== "concluido" || run.backfill,
      detalhes,
    };
  }

  // ---- Auditoria ----
  if (fase === "auditoria") {
    const ctx = await carregarContexto(companyId, run.janelaFim);
    const resultado = await executarAuditoria(ctx);

    await prisma.omieSyncRun.update({
      where: { id: run.id },
      data: {
        fase: "relatorio",
        cursor: null,
        invocacoes: { increment: 1 },
        achados: resultado.totalAbertos,
        detalhes: {
          supervisor: resultado.observacoesSupervisor,
          qualidadeDaBase: resultado.qualidadeDaBase,
          errosPorAgente: resultado.errosPorAgente,
          novos: resultado.novos,
          reincidentes: resultado.reincidentes,
          fechadosAutomaticamente: resultado.fechadosAutomaticamente,
          suprimidos: resultado.suprimidos,
        },
      },
    });

    detalhes.push(
      `Auditoria: ${resultado.novos} novo(s), ${resultado.reincidentes} reincidente(s), ` +
        `${resultado.fechadosAutomaticamente} fechado(s) automaticamente, ${resultado.suprimidos} suprimido(s) pelo supervisor. ` +
        `${resultado.totalAbertos} em aberto (${resultado.criticos} crítico(s)).`
    );

    return {
      runId: run.id,
      fase: "relatorio",
      backfill: false,
      janela: { inicio: run.janelaInicio, fim: run.janelaFim },
      concluido: false,
      continua: true,
      detalhes,
    };
  }

  // ---- Relatório ----
  if (fase === "relatorio") {
    const ctx = await carregarContexto(companyId, run.janelaFim);
    const resultado = await gerarEEnviarRelatorio(ctx);

    await prisma.omieSyncRun.update({
      where: { id: run.id },
      data: {
        fase: "concluido",
        status: "CONCLUIDO",
        finalizadoEm: new Date(),
        invocacoes: { increment: 1 },
        ...(resultado.erro ? { erro: [run.erro, resultado.erro].filter(Boolean).join(" | ").slice(0, 2000) } : {}),
      },
    });

    detalhes.push(
      resultado.enviado
        ? `Relatório enviado para ${resultado.destinatarios.join(", ")}.`
        : `Relatório gerado, mas não enviado: ${resultado.erro ?? "motivo não informado"}.`
    );

    return {
      runId: run.id,
      fase: "concluido",
      backfill: false,
      janela: { inicio: run.janelaInicio, fim: run.janelaFim },
      concluido: true,
      continua: false,
      detalhes,
    };
  }

  return {
    runId: run.id,
    fase: "concluido",
    backfill: run.backfill,
    janela: { inicio: run.janelaInicio, fim: run.janelaFim },
    concluido: true,
    continua: false,
    detalhes: ["Nada a fazer."],
  };
}

// Decide em que run trabalhar: retoma a execucao em andamento, abre a proxima
// janela de backfill ou abre o ciclo diario.
async function obterOuCriarRun(
  companyId: string,
  dataReferencia: Date,
  dataInicioBase: Date
): Promise<OmieSyncRun> {
  const emAndamento = await prisma.omieSyncRun.findFirst({
    where: { companyId, status: "EXECUTANDO" },
    orderBy: { iniciadoEm: "asc" },
  });
  if (emAndamento) return emAndamento;

  // Backfill pendente? A carga historica avanca de mes em mes ate alcancar o
  // mes corrente. Cada mes e uma janela propria — janelas menores cabem no teto
  // de tempo e, se uma falhar, so aquele mes precisa ser refeito.
  const ultimoBackfill = await prisma.omieSyncRun.findFirst({
    where: { companyId, backfill: true, status: "CONCLUIDO" },
    orderBy: { janelaFim: "desc" },
  });

  const mesCorrente = inicioDoMes(dataReferencia);
  const proximoMesBackfill = ultimoBackfill
    ? inicioDoMes(new Date(ultimoBackfill.janelaFim.getFullYear(), ultimoBackfill.janelaFim.getMonth() + 1, 1))
    : inicioDoMes(dataInicioBase);

  if (proximoMesBackfill < mesCorrente) {
    const fim = fimDoDia(new Date(proximoMesBackfill.getFullYear(), proximoMesBackfill.getMonth() + 1, 0));
    return prisma.omieSyncRun.create({
      data: {
        companyId,
        fase: "cadastros",
        janelaInicio: proximoMesBackfill,
        janelaFim: fim,
        backfill: true,
      },
    });
  }

  // Ciclo diario. A janela cobre D-1 e mais alguns dias para tras: a Omie
  // recebe lancamento retroativo com frequencia (a nota chega dias depois), e
  // uma janela de exatamente um dia perderia tudo que foi digitado com atraso.
  const janelaInicio = inicioDoDia(somarDias(dataReferencia, -3));
  return prisma.omieSyncRun.create({
    data: {
      companyId,
      fase: "cadastros",
      janelaInicio,
      janelaFim: fimDoDia(dataReferencia),
      backfill: false,
    },
  });
}

export function omieConfigurada(): boolean {
  return isOmieAvailable();
}

// Data de referencia do ciclo: D-1 no fuso de Brasilia. Calculado a partir do
// horario UTC do servidor (a Vercel roda em UTC) — usar a data local do
// processo faria o cron das 03:00 BRT (06:00 UTC) processar "hoje" em vez de
// "ontem" e o relatorio sairia sempre com um dia a mais.
export function dataReferenciaPadrao(agora = new Date()): Date {
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return inicioDoDia(new Date(brasilia.getFullYear(), brasilia.getMonth(), brasilia.getDate() - 1));
}
