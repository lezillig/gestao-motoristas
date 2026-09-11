import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { getLwToken, listarVeiculosLw, buscarMultasPorPlaca } from "./client";
import { matchVehicleToLw } from "./plateMatch";
import { resolveCondutorParaMulta } from "./resolveCondutor";
import type { LwMultaDTO } from "./types";

// dataInfracao/dataVencimento/apCondutorDataVencimento da LW vem como
// "yyyy-MM-dd HH:mm:ss.S" mas SEMPRE com hora zerada (a hora real da
// infracao fica em horaInfracao, campo separado) — e um ROTULO de data,
// mesma convencao de Escala.date/TimeClockEntry.date neste projeto (ver
// src/lib/date.ts), nao um timestamp real. Por isso usa parseLocalDate no
// prefixo "yyyy-MM-dd", nao new Date() na string inteira (que sofreria o
// mesmo bug de rollback de fuso ja documentado neste projeto).
//
// Confirmado real (2026-09-10): a LW usa a convencao "zero-date" do MySQL
// ("0000-00-00 00:00:00.0") pra dizer "esse prazo ainda nao foi definido"
// (ex.: apCondutorDataVencimento antes da multa ser imposta). O regex
// antigo so validava o FORMATO (4-2-2 digitos), entao "0000-00-00" batia
// e virava parseLocalDate("0000-00-00") = new Date(0,-1,0) — o
// construtor de Date do JS trata ano 0 como 1900 e "rola" mes -1/dia 0
// pra tras, resultando em 30/11/1899 (visto real na tela de Multas,
// coluna Prazo indicacao). Preciso rejeitar essa sentinela antes de
// parsear, nao so validar o formato.
function parseLwDateLabel(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  if (y === "0000" || m === "00" || d === "00") return null; // "sem data" da LW
  const parsed = parseLocalDate(`${y}-${m}-${d}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Pedido explicito do usuario (2026-09-10): so importar multas com
// infracao a partir de 2026-01-01 — a LW nao tem um parametro de data no
// endpoint por placa (so no endpoint por periodo, que exigiria trocar a
// estrategia de sync de "por veiculo" pra "por periodo", perdendo a
// tolerancia a placa mal cadastrada que o cruzamento por veiculo da, ver
// plateMatch.ts), entao o corte acontece aqui, depois de buscar — a
// chamada em si ainda traz o historico completo do veiculo, so nao vira
// linha na nossa tabela.
const MULTAS_SYNC_CUTOFF = parseLocalDate("2026-01-01");

function parseValorCents(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : Math.round(n * 100);
}

function parsePontuacao(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

export interface MultasSyncPlanItem {
  vehicleId: string;
  plate: string;
  placaParaConsulta: string;
}

export interface MultasSyncPlan {
  itens: MultasSyncPlanItem[];
  semCorrespondenciaNaLw: string[];
}

// 1a etapa (1 chamada curta): descobre, pra cada veiculo nosso, sob qual
// grafia ele esta cadastrado do lado da LW (ver src/lib/lw/plateMatch.ts).
// Roda separado do loop de busca de multas pelo mesmo motivo do TiqueTaque/
// Ituran (ver SyncAllButton): a frota inteira nao cabe numa unica invocacao
// serverless sem risco de timeout, entao o loop real roda no navegador, uma
// chamada por veiculo, com pausa entre elas.
export async function prepareMultasSyncPlan(companyId: string): Promise<MultasSyncPlan> {
  const token = await getLwToken();
  const [veiculosLw, nossosVeiculos] = await Promise.all([
    listarVeiculosLw(token),
    prisma.vehicle.findMany({ where: { companyId }, select: { id: true, plate: true } }),
  ]);

  const itens: MultasSyncPlanItem[] = [];
  const semCorrespondenciaNaLw: string[] = [];
  for (const vehicle of nossosVeiculos) {
    const match = matchVehicleToLw(vehicle.plate, veiculosLw);
    if (!match) {
      semCorrespondenciaNaLw.push(vehicle.plate);
      continue;
    }
    itens.push({ vehicleId: vehicle.id, plate: vehicle.plate, placaParaConsulta: match.placaParaConsulta });
  }
  return { itens, semCorrespondenciaNaLw };
}

export interface MultasSyncVehicleResult {
  criadas: number;
  atualizadas: number;
  totalMultas: number;
}

// 2a etapa: 1 veiculo por chamada (ver comentario acima). Faz login de novo
// a cada chamada, mesmo espirito de simplicidade ja usado no cliente SIAT/
// Ituran (uso pouco frequente, sem cache de token entre invocacoes).
export async function syncMultasForVehicle(
  companyId: string,
  vehicleId: string,
  placaParaConsulta: string
): Promise<MultasSyncVehicleResult> {
  const token = await getLwToken();
  const todasMultas = await buscarMultasPorPlaca(token, placaParaConsulta);
  // So a partir de MULTAS_SYNC_CUTOFF (ver comentario acima) — uma multa
  // sem dataInfracao reconhecivel tambem fica de fora, nao da pra confirmar
  // que e recente.
  const multas = todasMultas.filter((m) => {
    const data = parseLwDateLabel(m.dataInfracao);
    return data !== null && data >= MULTAS_SYNC_CUTOFF;
  });

  let criadas = 0;
  let atualizadas = 0;
  for (const m of multas) {
    const jaExiste = await prisma.multa.findUnique({ where: { lwId: m.id }, select: { id: true } });
    const data = buildMultaData(companyId, vehicleId, placaParaConsulta, m);
    await prisma.multa.upsert({
      where: { lwId: m.id },
      create: { lwId: m.id, ...data },
      update: data,
    });
    if (jaExiste) atualizadas++;
    else criadas++;
  }
  return { criadas, atualizadas, totalMultas: multas.length };
}

// Roda depois de syncMultasForVehicle pro mesmo veiculo — tenta resolver o
// condutor automaticamente pra cada multa nova/ainda pendente. Compartilhado
// entre a Server Action (sync manual, ver src/app/(app)/multas/actions.ts)
// e o cron diario (ver src/app/api/cron/lw-multas-import/route.ts), pra nao
// duplicar essa logica nos dois lugares.
export async function resolveCondutoresPendentes(companyId: string, vehicleId: string): Promise<void> {
  const multas = await prisma.multa.findMany({
    where: { vehicleId, companyId },
    include: { indicacao: true },
  });
  for (const multa of multas) {
    // Toda multa ganha uma linha de IndicacaoCondutor (mesmo sem sugestao
    // automatica, status fica PENDENTE_MANUAL) — sem isso, filtrar/ordenar
    // por status de indicacao na listagem teria que tratar "sem linha" e
    // "PENDENTE_MANUAL" como o mesmo caso em dois lugares diferentes.
    const podeAutoResolver =
      !multa.indicacao || (multa.indicacao.origemResolucao !== "MANUAL" && multa.indicacao.status === "PENDENTE_MANUAL");
    if (!podeAutoResolver) continue;

    const resolved = await resolveCondutorParaMulta({
      vehicleId: multa.vehicleId,
      dataInfracao: multa.dataInfracao,
      horaInfracao: multa.horaInfracao,
    });

    if (resolved.driverId) {
      await prisma.indicacaoCondutor.upsert({
        where: { multaId: multa.id },
        create: {
          companyId,
          multaId: multa.id,
          driverId: resolved.driverId,
          status: "SUGERIDA",
          origemResolucao: resolved.origem,
        },
        update: { driverId: resolved.driverId, status: "SUGERIDA", origemResolucao: resolved.origem },
      });
    } else if (!multa.indicacao) {
      await prisma.indicacaoCondutor.create({
        data: { companyId, multaId: multa.id, status: "PENDENTE_MANUAL" },
      });
    }
  }
}

function buildMultaData(companyId: string, vehicleId: string, placaConsultada: string, m: LwMultaDTO) {
  return {
    companyId,
    vehicleId,
    placaConsultada,
    ait: m.ait ?? null,
    descricao: m.descricao ?? null,
    artigo: m.artigo ?? null,
    orgao: m.orgao ?? null,
    cidade: m.cidade ?? null,
    uf: typeof m.uf === "string" ? m.uf : null,
    renavam: m.renavam ?? null,
    dataInfracao: parseLwDateLabel(m.dataInfracao),
    horaInfracao: m.horaInfracao ?? null,
    dataVencimento: parseLwDateLabel(m.dataVencimento),
    dataLimiteIndicacao: parseLwDateLabel(m.apCondutorDataVencimento),
    valorCents: parseValorCents(m.valor),
    pontuacao: parsePontuacao(m.pontuacao),
    situacaoLw: m.situacao ?? null,
    statusPagamento: m.statusPagamento ?? null,
    pagoLw: m.pagoLW ?? false,
    rawJson: JSON.parse(JSON.stringify(m)),
    syncedAt: new Date(),
  };
}
