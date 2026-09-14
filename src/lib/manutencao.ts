import { differenceInCalendarDays, format, subDays, subMonths, startOfMonth } from "date-fns";
import { prisma } from "@/lib/prisma";
import { currentKm, maintenanceIntervalKm } from "@/lib/maintenance";
import { OS_STATUS_ABERTOS } from "@/lib/sofit/manutencaoSync";

export const OS_STATUS_LABEL: Record<string, string> = {
  underApproval: "Aguardando aprovação",
  planned: "Planejada",
  inProgress: "Em andamento",
  waitingNf: "Aguardando NF",
  finished: "Concluída",
  canceled: "Cancelada",
};
export const OS_TIPO_LABEL: Record<string, string> = {
  preventive: "Preventiva",
  corrective: "Corretiva",
  improvement: "Melhoria",
  breakdown: "Quebra",
  accident: "Sinistro",
  tire: "Pneu",
  factory_warranty: "Garantia",
};
export const DISPONIBILIDADE_LABEL: Record<string, string> = {
  available: "Disponível",
  inMaintenance: "Em manutenção",
  inUse: "Em uso",
  inactive: "Inativo",
};

export const BACKLOG_ANTIGO_DIAS = 30;
export const APROVACAO_ATRASADA_DIAS = 7;
export const VENCIMENTO_JANELA_DIAS = 60;
const REINCIDENCIA_JANELA_DIAS = 90;
const REINCIDENCIA_MIN_OS = 3;

const TIPOS_CORRETIVOS = new Set(["corrective", "breakdown", "accident"]);

export type OsAberta = {
  id: string;
  numero: string;
  plate: string | null;
  tipo: string | null;
  status: string | null;
  criadaEm: Date;
  idadeDias: number;
  previsaoFimEm: Date | null;
  problema: string | null;
  fornecedor: string | null;
};

export type AderenciaVeiculo = {
  vehicleId: string;
  plate: string;
  modelo: string;
  kmAtual: number;
  intervaloKm: number;
  intervaloDias: number | null;
  ultimaKm: number | null;
  ultimaEm: Date | null;
  kmDesde: number | null;
  diasDesde: number | null;
  pct: number | null;
  situacao: "vencida" | "breve" | "em_dia" | "sem_historico";
  disponibilidade: string | null;
};

export type ManutencaoMes = { mes: string; total: number; corretivas: number; preventivas: number; externas: number; diasParado: number };
export type Reincidente = { plate: string; os: number; diasParado: number; problemas: string[] };
export type Fornecedor = { nome: string; os: number; diasParadoMedio: number };
export type Vencimento = { plate: string; tipo: string; venceEm: Date; dias: number; recorrencia: string | null };

export type Manutencao = {
  ultimaSync: Date | null;
  frota: { total: number; disponiveis: number; emManutencao: number; emUso: number; inativos: number; semSofit: number };
  parados: { plate: string; modelo: string; osAberta: OsAberta | null }[];
  backlog: { porStatus: Record<string, number>; total: number; itens: OsAberta[]; antigas: number; aprovacaoAtrasada: number };
  aderencia: { itens: AderenciaVeiculo[]; vencidas: number; breve: number; emDia: number; semHistorico: number };
  mensal: ManutencaoMes[];
  reincidentes: Reincidente[];
  fornecedores: Fornecedor[];
  vencimentos: { vencidos: Vencimento[]; proximos: Vencimento[]; antigosNaoAtualizados: number };
  higiene: { paradosSemOs: number; osAntigas: number; aprovacaoAtrasada: number; osSemVeiculo: number; vencimentosAntigos: number };
  termos: { termo: string; qtd: number }[];
};

const STOPWORDS = new Set(["PARA", "COM", "SEM", "DOS", "DAS", "DO", "DA", "DE", "EM", "NO", "NA", "CARRO", "VEICULO", "VEÍCULO", "ORDEM", "SERVIÇO", "SERVICO", "GERADA", "AUTOMATICAMENTE", "PARTIR", "PLANO", "MANUTENÇÃO", "MANUTENCAO", "VERIFICAR", "FAZER", "ESTA", "ESTÁ"]);

// Visao executiva de manutencao a partir do espelho da Sofit (OrdemServico,
// Vehicle.sofit*, VencimentoVeiculo). Tudo computado na hora — o espelho e
// atualizado pelo cron/botao, ver lib/sofit/manutencaoSync.ts.
export async function buildManutencao(companyId: string, now = new Date()): Promise<Manutencao> {
  const inicio180 = subDays(now, 180);
  const inicio90 = subDays(now, REINCIDENCIA_JANELA_DIAS);
  const [vehicles, osAbertas, osRecentes, vencimentosRows, ultimaOs] = await Promise.all([
    prisma.vehicle.findMany({
      where: { companyId },
      select: {
        id: true,
        plate: true,
        brand: true,
        model: true,
        status: true,
        currentMileage: true,
        lastMaintenanceMileage: true,
        sofitId: true,
        sofitStatus: true,
        sofitDisponibilidade: true,
        sofitOdometroKm: true,
        manutencaoIntervaloKm: true,
        manutencaoIntervaloDias: true,
        ultimaManutencaoEm: true,
      },
      orderBy: { plate: "asc" },
    }),
    prisma.ordemServico.findMany({
      where: { companyId, status: { in: [...OS_STATUS_ABERTOS] } },
      include: { vehicle: { select: { plate: true } } },
      orderBy: { criadaEm: "asc" },
    }),
    prisma.ordemServico.findMany({
      where: { companyId, criadaEm: { gte: inicio180 } },
      select: { vehicleId: true, placaOriginal: true, tipo: true, status: true, criadaEm: true, diasParado: true, fornecedor: true, problema: true },
    }),
    prisma.vencimentoVeiculo.findMany({ where: { companyId }, include: { vehicle: { select: { plate: true } } }, orderBy: { venceEm: "asc" } }),
    prisma.ordemServico.findFirst({ where: { companyId }, orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
  ]);

  // --- Frota agora (status ao vivo da Sofit) ---
  const comSofit = vehicles.filter((v) => v.sofitId && v.sofitStatus === "active");
  const cont = (d: string) => comSofit.filter((v) => v.sofitDisponibilidade === d).length;
  const frota = {
    total: comSofit.length,
    disponiveis: cont("available"),
    emManutencao: cont("inMaintenance"),
    emUso: cont("inUse"),
    inativos: vehicles.filter((v) => v.sofitId && v.sofitStatus !== "active").length,
    semSofit: vehicles.filter((v) => !v.sofitId && v.status !== "INATIVO").length,
  };

  const toAberta = (o: (typeof osAbertas)[number]): OsAberta => ({
    id: o.id,
    numero: o.numero,
    plate: o.vehicle?.plate ?? o.placaOriginal,
    tipo: o.tipo,
    status: o.status,
    criadaEm: o.criadaEm,
    idadeDias: differenceInCalendarDays(now, o.criadaEm),
    previsaoFimEm: o.previsaoFimEm,
    problema: o.problema,
    fornecedor: o.fornecedor,
  });
  const abertas = osAbertas.map(toAberta);
  const abertaPorVeiculo = new Map<string, OsAberta>();
  for (const o of osAbertas) if (o.vehicleId && !abertaPorVeiculo.has(o.vehicleId)) abertaPorVeiculo.set(o.vehicleId, toAberta(o));

  const parados = comSofit
    .filter((v) => v.sofitDisponibilidade === "inMaintenance")
    .map((v) => ({ plate: v.plate, modelo: `${v.brand} ${v.model}`.trim(), osAberta: abertaPorVeiculo.get(v.id) ?? null }))
    .sort((a, b) => (b.osAberta?.idadeDias ?? -1) - (a.osAberta?.idadeDias ?? -1));

  // --- Backlog ---
  const porStatus: Record<string, number> = {};
  for (const o of abertas) porStatus[o.status ?? "?"] = (porStatus[o.status ?? "?"] ?? 0) + 1;
  const antigas = abertas.filter((o) => o.status === "inProgress" && o.idadeDias > BACKLOG_ANTIGO_DIAS).length;
  const aprovacaoAtrasada = abertas.filter((o) => o.status === "underApproval" && o.idadeDias > APROVACAO_ATRASADA_DIAS).length;

  // --- Aderencia ao plano ---
  const aderenciaItens: AderenciaVeiculo[] = comSofit
    .filter((v) => v.manutencaoIntervaloKm || v.manutencaoIntervaloDias)
    .map((v) => {
      const kmAtual = currentKm(v);
      const intervaloKm = maintenanceIntervalKm(v);
      const temHistorico = v.lastMaintenanceMileage > 0 || v.ultimaManutencaoEm != null;
      const kmDesde = v.lastMaintenanceMileage > 0 ? kmAtual - v.lastMaintenanceMileage : null;
      const diasDesde = v.ultimaManutencaoEm ? differenceInCalendarDays(now, v.ultimaManutencaoEm) : null;
      const pctKm = kmDesde != null ? kmDesde / intervaloKm : null;
      const pctDias = diasDesde != null && v.manutencaoIntervaloDias ? diasDesde / v.manutencaoIntervaloDias : null;
      const pct = pctKm != null || pctDias != null ? Math.max(pctKm ?? 0, pctDias ?? 0) : null;
      const situacao: AderenciaVeiculo["situacao"] = !temHistorico || pct == null ? "sem_historico" : pct >= 1 ? "vencida" : pct >= 0.8 ? "breve" : "em_dia";
      return {
        vehicleId: v.id,
        plate: v.plate,
        modelo: `${v.brand} ${v.model}`.trim(),
        kmAtual,
        intervaloKm,
        intervaloDias: v.manutencaoIntervaloDias,
        ultimaKm: v.lastMaintenanceMileage > 0 ? v.lastMaintenanceMileage : null,
        ultimaEm: v.ultimaManutencaoEm,
        kmDesde,
        diasDesde,
        pct,
        situacao,
        disponibilidade: v.sofitDisponibilidade,
      };
    })
    .sort((a, b) => {
      const ordem = { vencida: 0, breve: 1, em_dia: 2, sem_historico: 3 };
      return ordem[a.situacao] - ordem[b.situacao] || (b.pct ?? 0) - (a.pct ?? 0);
    });
  const aderencia = {
    itens: aderenciaItens,
    vencidas: aderenciaItens.filter((i) => i.situacao === "vencida").length,
    breve: aderenciaItens.filter((i) => i.situacao === "breve").length,
    emDia: aderenciaItens.filter((i) => i.situacao === "em_dia").length,
    semHistorico: aderenciaItens.filter((i) => i.situacao === "sem_historico").length,
  };

  // --- Mensal (6 meses) ---
  const meses: ManutencaoMes[] = [];
  for (let i = 5; i >= 0; i--) {
    const m = format(startOfMonth(subMonths(now, i)), "yyyy-MM");
    meses.push({ mes: m, total: 0, corretivas: 0, preventivas: 0, externas: 0, diasParado: 0 });
  }
  const mesIdx = new Map(meses.map((m, i) => [m.mes, i]));
  for (const o of osRecentes) {
    const i = mesIdx.get(format(o.criadaEm, "yyyy-MM"));
    if (i == null) continue;
    const m = meses[i];
    m.total++;
    if (TIPOS_CORRETIVOS.has(o.tipo ?? "")) m.corretivas++;
    if (o.tipo === "preventive") m.preventivas++;
    if (o.fornecedor && !/AZUL\s*MOB/i.test(o.fornecedor)) m.externas++;
    m.diasParado += o.diasParado ?? 0;
  }

  // --- Reincidentes e fornecedores (90 dias) ---
  const plateById = new Map(vehicles.map((v) => [v.id, v.plate]));
  const porVeiculo = new Map<string, { os: number; diasParado: number; problemas: string[] }>();
  const porFornecedor = new Map<string, { os: number; diasParado: number; comDias: number }>();
  const termos = new Map<string, number>();
  for (const o of osRecentes) {
    if (o.criadaEm < inicio90) continue;
    const plate = (o.vehicleId && plateById.get(o.vehicleId)) || o.placaOriginal || "?";
    const acc = porVeiculo.get(plate) ?? { os: 0, diasParado: 0, problemas: [] };
    acc.os++;
    acc.diasParado += o.diasParado ?? 0;
    const p = o.problema?.split("\n")[0]?.trim();
    if (p && acc.problemas.length < 4 && !acc.problemas.includes(p)) acc.problemas.push(p.slice(0, 60));
    porVeiculo.set(plate, acc);
    const f = o.fornecedor?.trim() || "Sem fornecedor";
    const fa = porFornecedor.get(f) ?? { os: 0, diasParado: 0, comDias: 0 };
    fa.os++;
    if (o.diasParado != null) {
      fa.diasParado += o.diasParado;
      fa.comDias++;
    }
    porFornecedor.set(f, fa);
    for (const w of (o.problema ?? "").toUpperCase().split(/[^A-ZÇÃÕÁÉÍÓÚÂÊÔ]+/)) {
      if (w.length > 4 && !STOPWORDS.has(w)) termos.set(w, (termos.get(w) ?? 0) + 1);
    }
  }
  const reincidentes = [...porVeiculo.entries()]
    .filter(([, a]) => a.os >= REINCIDENCIA_MIN_OS)
    .map(([plate, a]) => ({ plate, ...a }))
    .sort((a, b) => b.os - a.os || b.diasParado - a.diasParado)
    .slice(0, 12);
  const fornecedores = [...porFornecedor.entries()]
    .map(([nome, a]) => ({ nome, os: a.os, diasParadoMedio: a.comDias > 0 ? Math.round((a.diasParado / a.comDias) * 10) / 10 : 0 }))
    .sort((a, b) => b.os - a.os)
    .slice(0, 8);

  // --- Vencimentos ---
  const toVenc = (r: (typeof vencimentosRows)[number]): Vencimento => ({
    plate: r.vehicle.plate,
    tipo: r.tipo,
    venceEm: r.venceEm,
    dias: differenceInCalendarDays(r.venceEm, now),
    recorrencia: r.recorrencia,
  });
  const limite = subDays(now, 365);
  const vencidos = vencimentosRows.filter((r) => r.venceEm < now && r.venceEm >= limite).map(toVenc).sort((a, b) => a.dias - b.dias);
  const proximos = vencimentosRows
    .filter((r) => r.venceEm >= now && differenceInCalendarDays(r.venceEm, now) <= VENCIMENTO_JANELA_DIAS)
    .map(toVenc);
  const antigosNaoAtualizados = vencimentosRows.filter((r) => r.venceEm < limite).length;

  return {
    ultimaSync: ultimaOs?.syncedAt ?? null,
    frota,
    parados,
    backlog: { porStatus, total: abertas.length, itens: abertas, antigas, aprovacaoAtrasada },
    aderencia,
    mensal: meses,
    reincidentes,
    fornecedores,
    vencimentos: { vencidos, proximos, antigosNaoAtualizados },
    higiene: {
      paradosSemOs: parados.filter((p) => !p.osAberta).length,
      osAntigas: antigas,
      aprovacaoAtrasada,
      osSemVeiculo: osAbertas.filter((o) => !o.vehicleId).length,
      vencimentosAntigos: antigosNaoAtualizados,
    },
    termos: [...termos.entries()]
      .map(([termo, qtd]) => ({ termo, qtd }))
      .sort((a, b) => b.qtd - a.qtd)
      .slice(0, 12),
  };
}
