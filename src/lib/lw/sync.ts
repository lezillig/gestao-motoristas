import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { getLwToken, listarVeiculosLw, buscarMultasPorPlaca } from "./client";
import { matchVehicleToLw } from "./plateMatch";
import type { LwMultaDTO } from "./types";

// dataInfracao/dataVencimento/apCondutorDataVencimento da LW vem como
// "yyyy-MM-dd HH:mm:ss.S" mas SEMPRE com hora zerada (a hora real da
// infracao fica em horaInfracao, campo separado) — e um ROTULO de data,
// mesma convencao de Escala.date/TimeClockEntry.date neste projeto (ver
// src/lib/date.ts), nao um timestamp real. Por isso usa parseLocalDate no
// prefixo "yyyy-MM-dd", nao new Date() na string inteira (que sofreria o
// mesmo bug de rollback de fuso ja documentado neste projeto).
function parseLwDateLabel(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match) return null;
  const parsed = parseLocalDate(match[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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
  const multas = await buscarMultasPorPlaca(token, placaParaConsulta);

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
