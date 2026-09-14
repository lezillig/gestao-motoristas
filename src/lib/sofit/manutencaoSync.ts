import { addMonths, addYears } from "date-fns";
import { prisma } from "@/lib/prisma";
import { platePhysicalVariants } from "@/lib/plate";
import { fetchServiceOrdersSince, fetchSofitItem, fetchSofitVehicles } from "./client";

// Vencimento recorrente na Sofit guarda a data ORIGINAL do cadastro (visto
// real: IPVA "yearly" com due_date de 2023/2025) — a proxima ocorrencia e o
// que interessa pra operacao. Avanca a recorrencia ate a data ficar a menos
// de 30 dias no passado ou no futuro (30 dias de tolerancia pra um IPVA
// vencido semana passada continuar aparecendo como vencido, nao pular pro
// ano que vem). Sem recorrencia reconhecida, mantem a data como esta.
function proximaOcorrencia(venceEm: Date, recorrente: boolean, recorrencia: string | null, agora: Date): Date {
  if (!recorrente || !recorrencia) return venceEm;
  const r = recorrencia.toLowerCase();
  const avancar = r.startsWith("year") || r.startsWith("anual")
    ? (d: Date) => addYears(d, 1)
    : r.startsWith("month") || r.startsWith("mensal")
      ? (d: Date) => addMonths(d, 1)
      : r.startsWith("semi")
        ? (d: Date) => addMonths(d, 6)
        : null;
  if (!avancar) return venceEm;
  const limite = agora.getTime() - 30 * 86_400_000;
  let d = venceEm;
  for (let i = 0; i < 40 && d.getTime() < limite; i++) d = avancar(d);
  return d;
}

export const SOFIT_MANUTENCAO_EPOCH = new Date("2020-01-01T00:00:00.000Z");
export const OS_STATUS_ABERTOS = ["underApproval", "planned", "inProgress", "waitingNf"] as const;

function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function mapaPlacaVeiculo(companyId: string): Promise<Map<string, string>> {
  const vehicles = await prisma.vehicle.findMany({ where: { companyId }, select: { id: true, plate: true } });
  const map = new Map<string, string>();
  for (const v of vehicles) for (const p of platePhysicalVariants(v.plate)) map.set(p, v.id);
  return map;
}

// Cursor = maior updated_at ja gravado (+1ms, ver fetchServiceOrdersSince)
// — na primeira carga, desde 2020 (a Sofit deles tem OS de 2024 em diante).
export async function ultimoCursorOs(companyId: string): Promise<Date> {
  const last = await prisma.ordemServico.findFirst({ where: { companyId }, orderBy: { atualizadaEm: "desc" }, select: { atualizadaEm: true } });
  return last ? new Date(last.atualizadaEm.getTime() + 1) : SOFIT_MANUTENCAO_EPOCH;
}

export type SyncOsResult = { upserted: number; semVeiculo: number; hasMore: boolean; nextSince: Date };

export async function syncOrdensServicoSofit(companyId: string, since: Date, deadline: number): Promise<SyncOsResult> {
  const [placas, r] = await Promise.all([mapaPlacaVeiculo(companyId), fetchServiceOrdersSince(since, deadline)]);
  let upserted = 0;
  let semVeiculo = 0;
  for (const o of r.orders) {
    const vehicleId = o.plate ? (placas.get(normalizePlate(o.plate)) ?? null) : null;
    if (!vehicleId) semVeiculo++;
    const data = {
      vehicleId,
      numero: o.numero,
      placaOriginal: o.plate,
      tipo: o.tipo,
      status: o.status,
      origem: o.origem,
      motivo: o.motivo,
      problema: o.problema,
      fornecedor: o.fornecedor,
      criadaEm: o.criadaEm,
      atualizadaEm: o.atualizadaEm,
      inicioEm: o.inicioEm,
      fimEm: o.fimEm,
      previsaoFimEm: o.previsaoFimEm,
      diasParado: o.diasParado,
      hodometroFinal: o.hodometroFinal,
      custoCents: o.custoCents,
      syncedAt: new Date(),
    };
    await prisma.ordemServico.upsert({ where: { sofitId: o.sofitId }, create: { companyId, sofitId: o.sofitId, ...data }, update: data });
    upserted++;
  }
  return { upserted, semVeiculo, hasMore: r.hasMore, nextSince: r.nextSince };
}

export type SyncVeiculosResult = { atualizados: number; semPar: number; vencimentos: number };

// Enriquece Vehicle com o que a Sofit sabe (disponibilidade ao vivo,
// hodometro, intervalo de manutencao) e substitui os vencimentos do veiculo.
// So veiculos que casam por placa com o nosso cadastro; os demais (veiculo
// baixado la, placa diferente) so entram na contagem `semPar`.
export async function syncVeiculosSofit(companyId: string, deadline: number): Promise<SyncVeiculosResult> {
  const [placas, veiculos] = await Promise.all([mapaPlacaVeiculo(companyId), fetchSofitVehicles(deadline)]);
  const itemCache = new Map<string, { name: string; type: string | null } | null>();
  const nomeItem = async (id: string | null) => {
    if (!id) return null;
    if (!itemCache.has(id)) itemCache.set(id, await fetchSofitItem(id).catch(() => null));
    return itemCache.get(id) ?? null;
  };

  let atualizados = 0;
  let semPar = 0;
  let vencimentos = 0;
  const agora = new Date();
  for (const v of veiculos) {
    const vehicleId = v.plate ? placas.get(normalizePlate(v.plate)) : undefined;
    if (!vehicleId) {
      semPar++;
      continue;
    }
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        sofitId: v.sofitId,
        sofitStatus: v.status,
        sofitDisponibilidade: v.disponibilidade,
        sofitOdometroKm: v.odometroKm,
        manutencaoIntervaloKm: v.intervaloKm,
        manutencaoIntervaloDias: v.intervaloDias,
        sofitSyncedAt: agora,
      },
    });
    const rows = [];
    for (const d of v.dues) {
      const item = await nomeItem(d.itemId);
      rows.push({
        companyId,
        vehicleId,
        sofitDueId: d.sofitDueId,
        tipo: item?.name ?? "Vencimento",
        categoria: item?.type ?? null,
        venceEm: proximaOcorrencia(d.venceEm, d.recorrente, d.recorrencia, agora),
        recorrente: d.recorrente,
        recorrencia: d.recorrencia,
        syncedAt: agora,
      });
    }
    await prisma.$transaction([
      prisma.vencimentoVeiculo.deleteMany({ where: { vehicleId } }),
      ...(rows.length > 0 ? [prisma.vencimentoVeiculo.createMany({ data: rows, skipDuplicates: true })] : []),
    ]);
    vencimentos += rows.length;
    atualizados++;
  }
  return { atualizados, semPar, vencimentos };
}

// "Ultima manutencao" real por veiculo = ultima OS concluida que seja
// preventiva OU cuja descricao seja revisao/troca de oleo (na Sofit deles
// 88% das OS sao "corretivas" mesmo quando sao revisao — confirmado na
// amostra). Alimenta Vehicle.lastMaintenanceMileage/ultimaManutencaoEm, que
// o alerta de manutencao (lib/maintenance.ts) compara com o intervalo do
// proprio veiculo. Nunca baixa um lastMaintenanceMileage ja maior.
const REVISAO_REGEX = /REVIS|TROCA\s+DE\s+[OÓ]LEO|PREVENTIVA|\b[OÓ]LEO\b/i;

export async function atualizarUltimaManutencao(companyId: string): Promise<number> {
  const os = await prisma.ordemServico.findMany({
    where: { companyId, vehicleId: { not: null }, status: "finished", fimEm: { not: null }, hodometroFinal: { gt: 0 } },
    select: { vehicleId: true, tipo: true, problema: true, fimEm: true, hodometroFinal: true },
    orderBy: { fimEm: "desc" },
  });
  const ultimaPorVeiculo = new Map<string, { fimEm: Date; km: number }>();
  for (const o of os) {
    if (!o.vehicleId || ultimaPorVeiculo.has(o.vehicleId)) continue;
    const ehRevisao = o.tipo === "preventive" || REVISAO_REGEX.test(o.problema ?? "");
    if (!ehRevisao) continue;
    ultimaPorVeiculo.set(o.vehicleId, { fimEm: o.fimEm!, km: o.hodometroFinal! });
  }
  let atualizados = 0;
  for (const [vehicleId, u] of ultimaPorVeiculo) {
    const r = await prisma.vehicle.updateMany({
      where: { id: vehicleId, OR: [{ ultimaManutencaoEm: null }, { ultimaManutencaoEm: { lt: u.fimEm } }] },
      data: { ultimaManutencaoEm: u.fimEm, lastMaintenanceMileage: u.km },
    });
    atualizados += r.count;
  }
  return atualizados;
}
