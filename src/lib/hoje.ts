import { addDays, differenceInCalendarDays, format, subDays } from "date-fns";
import type { StatusIndicacaoCondutor } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { brazilDayLabel, brazilMidnightUtc } from "@/lib/date";
import { requiresCnh } from "@/lib/driverAlerts";
import { buildCnhVigia, type CnhRisco } from "@/lib/cnhVigia";
import { fetchExcecoesDoDia, LEAVE_LABELS, type ExcecaoDia } from "@/lib/excecoesDia";
import { fetchPrazoAlertCounts } from "@/lib/multasList";
import { checkAllGaps, RECURRING_GAP_WINDOW_DAYS } from "@/lib/integrationGaps";
import { isMaintenanceDue, kmSinceLastMaintenance } from "@/lib/maintenance";

// Mesma janela do aviso em /multas — "vencendo" e o que ainda da pra agir;
// "vencido" so entra como contagem (nao tem mais o que fazer na LW).
export const MULTAS_PRAZO_JANELA_DIAS = 5;
const ITENS_POR_SECAO = 8;

export type HojeMultaPrazo = {
  id: string;
  placa: string;
  ait: string | null;
  dataLimiteIndicacao: Date;
  diasRestantes: number;
  valorCents: number | null;
  status: StatusIndicacaoCondutor;
  condutorSugerido: string | null;
};

export type HojeCnh = CnhRisco & { diasParaVencer: number | null; afastamento: string | null };

export type HojeEscalaSemViagem = {
  vehicleId: string;
  plate: string;
  driverId: string;
  motoristas: string[];
  clientes: string[];
  escalas: number;
};

export type HojeCartao = {
  numeroCartao: string;
  plate: string;
  saldoCents: number | null;
  limiteCents: number | null;
  situacao: "bloqueado" | "saldo_baixo";
};

export type HojeIntegracao = { sistema: string; missingDays: string[]; lastDate: Date | null };
export type HojeManutencao = { vehicleId: string; plate: string; kmDesde: number };
export type HojeAfastado = { driverName: string; tipo: string; ate: Date };
export type HojeVencimento = { plate: string; tipo: string; venceEm: Date; dias: number };
export type HojeManutencaoSofit = {
  emManutencao: number;
  paradosSemOs: number;
  aprovacaoAtrasada: number;
  vencimentos: HojeVencimento[];
  vencimentosTotal: number;
  vencidos: number;
};
export const VENCIMENTO_HOJE_JANELA_DIAS = 30;

export type Hoje = {
  hojeLabel: Date;
  ontemLabel: Date;
  urgentes: number;
  avisos: number;
  resumo: { escalasHoje: number; motoristasEscalados: number; veiculosEscalados: number };
  multas: { vencidas: number; vencendo: number; itens: HojeMultaPrazo[] };
  cnh: { vencidas: number; venceEmBreve: number; itens: HojeCnh[] };
  excecoesOntem: { total: number; semAfastamento: number; itens: ExcecaoDia[] };
  escalaSemViagem: { ituranSemDadosOntem: boolean; total: number; itens: HojeEscalaSemViagem[] };
  cartoes: HojeCartao[];
  integracoes: HojeIntegracao[];
  manutencao: HojeManutencao[];
  manutencaoSofit: HojeManutencaoSofit;
  afastadosHoje: HojeAfastado[];
};

const SISTEMAS_GAP = [
  ["tiquetaquePonto", "TiqueTaque (ponto)"],
  ["siat", "SIAT (escalas)"],
  ["sofit", "Sofit (abastecimentos)"],
  ["ituran", "Ituran (viagens)"],
] as const;

// Reune num lugar so o que cada modulo ja calcula separado (prazo de multa,
// CNH, escala x ponto, viagem da Ituran, cartao, lacuna de integracao,
// manutencao) e devolve so o que precisa de decisao HOJE. Nenhuma regra
// nova aqui — cada bloco reaproveita a mesma funcao/consulta da tela de
// origem, pra numero do painel e numero da tela nunca discordarem.
export async function buildHoje(companyId: string, now = new Date()): Promise<Hoje> {
  const hojeLabel = brazilDayLabel(0);
  const ontemLabel = brazilDayLabel(-1);
  const ontemISO = format(ontemLabel, "yyyy-MM-dd");
  // Escala.date, DriverLeave.*Date e Multa.dataLimiteIndicacao sao ROTULOS
  // (meia-noite UTC): comparar com o rotulo de hoje, nunca com o instante
  // `now` — senao a partir das 21h de Brasilia o dia corrente "some".
  const limitePrazo = addDays(hojeLabel, MULTAS_PRAZO_JANELA_DIAS);
  const semIndicacaoConfirmada = { status: { notIn: ["ENVIADA", "VALIDADA"] as StatusIndicacaoCondutor[] } };

  const [
    multasVencendo,
    prazoCounts,
    drivers,
    afastamentos,
    escalasHoje,
    escalasOntem,
    tripsOntem,
    cartoes,
    gaps,
    vehicles,
    excecoesOntem,
    vencimentosRows,
    osAbertas,
  ] = await Promise.all([
    prisma.multa.findMany({
      where: { companyId, dataLimiteIndicacao: { gte: hojeLabel, lte: limitePrazo }, indicacao: semIndicacaoConfirmada },
      include: { vehicle: { select: { plate: true } }, indicacao: { include: { driver: { select: { name: true } } } } },
      orderBy: { dataLimiteIndicacao: "asc" },
      take: ITENS_POR_SECAO,
    }),
    fetchPrazoAlertCounts(companyId, now),
    prisma.driver.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, funcao: true, departamento: true, cnhCategory: true, cnhExpiration: true },
    }),
    prisma.driverLeave.findMany({
      where: { companyId, startDate: { lte: hojeLabel }, endDate: { gte: hojeLabel } },
      select: { driverId: true, leaveType: true, endDate: true },
    }),
    prisma.escala.findMany({ where: { companyId, date: hojeLabel }, select: { driverId: true, vehicleId: true } }),
    prisma.escala.findMany({
      where: { companyId, date: ontemLabel, vehicleId: { not: null } },
      select: {
        vehicleId: true,
        clientName: true,
        routeName: true,
        driver: { select: { id: true, name: true } },
        vehicle: { select: { plate: true } },
      },
    }),
    prisma.vehicleTrip.findMany({
      where: { companyId, startAt: { gte: brazilMidnightUtc(-1), lt: brazilMidnightUtc(0) } },
      select: { vehicleId: true },
      distinct: ["vehicleId"],
    }),
    prisma.fuelCardStatus.findMany({
      where: { companyId },
      select: {
        numeroCartao: true,
        placaOriginal: true,
        situacaoCartao: true,
        saldoCents: true,
        limiteCents: true,
        vehicle: { select: { plate: true } },
      },
    }),
    checkAllGaps(companyId, RECURRING_GAP_WINDOW_DAYS),
    prisma.vehicle.findMany({
      where: { companyId, status: { not: "INATIVO" } },
      select: {
        id: true,
        plate: true,
        currentMileage: true,
        lastMaintenanceMileage: true,
        manutencaoIntervaloKm: true,
        sofitOdometroKm: true,
        sofitStatus: true,
        sofitDisponibilidade: true,
      },
    }),
    fetchExcecoesDoDia(companyId, ontemLabel),
    prisma.vencimentoVeiculo.findMany({
      where: { companyId, venceEm: { gte: subDays(now, 365), lte: addDays(now, VENCIMENTO_HOJE_JANELA_DIAS) } },
      include: { vehicle: { select: { plate: true } } },
      orderBy: { venceEm: "asc" },
    }),
    prisma.ordemServico.findMany({
      where: { companyId, status: { in: ["underApproval", "planned", "inProgress", "waitingNf"] } },
      select: { vehicleId: true, status: true, criadaEm: true },
    }),
  ]);

  // --- Multas: prazo de indicacao ---
  const multasItens: HojeMultaPrazo[] = multasVencendo.map((m) => ({
    id: m.id,
    placa: m.vehicle?.plate ?? m.placaConsultada,
    ait: m.ait,
    dataLimiteIndicacao: m.dataLimiteIndicacao!,
    diasRestantes: differenceInCalendarDays(m.dataLimiteIndicacao!, now),
    valorCents: m.valorCents,
    status: m.indicacao?.status ?? "PENDENTE_MANUAL",
    condutorSugerido: m.indicacao?.driver?.name ?? null,
  }));

  // --- CNH (so quem dirige, e cruzado com afastamento de hoje) ---
  const afastamentoByDriverId = new Map(afastamentos.map((a) => [a.driverId, a]));
  const motoristas = drivers.filter((d) => requiresCnh(d.funcao, d.departamento));
  const indisponiveis = new Set(motoristas.filter((d) => afastamentoByDriverId.has(d.id)).map((d) => d.id));
  const riscos = await buildCnhVigia(companyId, motoristas, indisponiveis, now);
  const cnhItens: HojeCnh[] = riscos
    .map((r) => {
      const afastamento = afastamentoByDriverId.get(r.driverId);
      return {
        ...r,
        diasParaVencer: r.cnhExpiration ? differenceInCalendarDays(r.cnhExpiration, now) : null,
        afastamento: afastamento ? (LEAVE_LABELS[afastamento.leaveType] ?? afastamento.leaveType) : null,
      };
    })
    // Vencida com viagem agendada primeiro (decisao urgente), depois vencida
    // sem viagem, depois "vence em breve" — e dentro de cada grupo pela data.
    .sort((a, b) => {
      const pa = (a.nivel === "vencida" ? 0 : 2) + (a.proximaViagem ? 0 : 1);
      const pb = (b.nivel === "vencida" ? 0 : 2) + (b.proximaViagem ? 0 : 1);
      if (pa !== pb) return pa - pb;
      return (a.cnhExpiration?.getTime() ?? Infinity) - (b.cnhExpiration?.getTime() ?? Infinity);
    });

  // --- Escala de ontem sem nenhuma viagem na Ituran ---
  const veiculosComViagem = new Set(tripsOntem.map((t) => t.vehicleId));
  const semViagemPorVeiculo = new Map<string, HojeEscalaSemViagem>();
  for (const e of escalasOntem) {
    if (!e.vehicleId || !e.vehicle || veiculosComViagem.has(e.vehicleId)) continue;
    const item = semViagemPorVeiculo.get(e.vehicleId) ?? {
      vehicleId: e.vehicleId,
      plate: e.vehicle.plate,
      driverId: e.driver.id,
      motoristas: [],
      clientes: [],
      escalas: 0,
    };
    item.escalas += 1;
    if (!item.motoristas.includes(e.driver.name)) item.motoristas.push(e.driver.name);
    const cliente = e.clientName ?? e.routeName;
    if (cliente && !item.clientes.includes(cliente)) item.clientes.push(cliente);
    semViagemPorVeiculo.set(e.vehicleId, item);
  }
  // Se a Ituran nao trouxe NADA ontem pra frota inteira, o problema e o
  // sync, nao os veiculos — listar todos como "sem viagem" so confundiria.
  const ituranSemDadosOntem = tripsOntem.length === 0 && escalasOntem.length > 0;
  const semViagem = ituranSemDadosOntem ? [] : [...semViagemPorVeiculo.values()].sort((a, b) => b.escalas - a.escalas);

  // --- Cartoes de combustivel ---
  const cartoesItens: HojeCartao[] = [];
  for (const c of cartoes) {
    const plate = c.vehicle?.plate ?? c.placaOriginal;
    if (c.situacaoCartao === "B") {
      cartoesItens.push({ numeroCartao: c.numeroCartao, plate, saldoCents: c.saldoCents, limiteCents: c.limiteCents, situacao: "bloqueado" });
    } else if (
      c.situacaoCartao === "A" &&
      c.limiteCents != null &&
      c.limiteCents > 0 &&
      c.saldoCents != null &&
      c.saldoCents / c.limiteCents < 0.1
    ) {
      cartoesItens.push({ numeroCartao: c.numeroCartao, plate, saldoCents: c.saldoCents, limiteCents: c.limiteCents, situacao: "saldo_baixo" });
    }
  }
  cartoesItens.sort((a, b) => (a.saldoCents ?? 0) - (b.saldoCents ?? 0));

  // --- Integracoes: so o que exige acao (ontem faltou, ou 3+ dias) — 1 dia
  // isolado no meio da semana pode ser feriado/domingo sem operacao.
  const integracoes: HojeIntegracao[] = SISTEMAS_GAP.flatMap(([key, sistema]) => {
    const g = gaps[key];
    const relevante = g.missingDays.includes(ontemISO) || g.missingDays.length >= 3;
    return relevante ? [{ sistema, missingDays: g.missingDays, lastDate: g.lastDate }] : [];
  });

  // --- Manutencao preventiva ---
  const manutencao: HojeManutencao[] = vehicles
    .filter(isMaintenanceDue)
    .map((v) => ({ vehicleId: v.id, plate: v.plate, kmDesde: kmSinceLastMaintenance(v) }))
    .sort((a, b) => b.kmDesde - a.kmDesde);

  // --- Manutencao (espelho da Sofit): parados agora, aprovacao travada, vencimentos legais ---
  const comOsAberta = new Set(osAbertas.map((o) => o.vehicleId).filter(Boolean));
  const emManutencaoList = vehicles.filter((v) => v.sofitStatus === "active" && v.sofitDisponibilidade === "inMaintenance");
  const vencimentosItens: HojeVencimento[] = vencimentosRows.map((r) => ({
    plate: r.vehicle.plate,
    tipo: r.tipo,
    venceEm: r.venceEm,
    dias: differenceInCalendarDays(r.venceEm, now),
  }));
  const manutencaoSofit: HojeManutencaoSofit = {
    emManutencao: emManutencaoList.length,
    paradosSemOs: emManutencaoList.filter((v) => !comOsAberta.has(v.id)).length,
    aprovacaoAtrasada: osAbertas.filter((o) => o.status === "underApproval" && differenceInCalendarDays(now, o.criadaEm) > 7).length,
    vencimentos: vencimentosItens.slice(0, ITENS_POR_SECAO),
    vencimentosTotal: vencimentosItens.length,
    vencidos: vencimentosItens.filter((v) => v.dias < 0).length,
  };

  // --- Afastados hoje (so motoristas) ---
  const nomeByDriverId = new Map(motoristas.map((d) => [d.id, d.name]));
  const afastadosHoje: HojeAfastado[] = afastamentos
    .filter((a) => nomeByDriverId.has(a.driverId))
    .map((a) => ({ driverName: nomeByDriverId.get(a.driverId)!, tipo: LEAVE_LABELS[a.leaveType] ?? a.leaveType, ate: a.endDate }))
    .sort((a, b) => a.driverName.localeCompare(b.driverName, "pt-BR"));

  const cnhVencidas = riscos.filter((r) => r.nivel === "vencida").length;
  const cnhVenceEmBreve = riscos.length - cnhVencidas;
  const excecoesSemAfastamento = excecoesOntem.filter((e) => !e.afastamento).length;

  return {
    hojeLabel,
    ontemLabel,
    urgentes: prazoCounts.vencendoEm5Dias + cnhVencidas,
    avisos:
      cnhVenceEmBreve +
      excecoesSemAfastamento +
      semViagem.length +
      cartoesItens.length +
      integracoes.length +
      manutencao.length +
      manutencaoSofit.vencimentosTotal +
      manutencaoSofit.paradosSemOs,
    resumo: {
      escalasHoje: escalasHoje.length,
      motoristasEscalados: new Set(escalasHoje.map((e) => e.driverId)).size,
      veiculosEscalados: new Set(escalasHoje.map((e) => e.vehicleId).filter(Boolean)).size,
    },
    multas: { vencidas: prazoCounts.vencido, vencendo: prazoCounts.vencendoEm5Dias, itens: multasItens },
    cnh: { vencidas: cnhVencidas, venceEmBreve: cnhVenceEmBreve, itens: cnhItens.slice(0, ITENS_POR_SECAO) },
    excecoesOntem: {
      total: excecoesOntem.length,
      semAfastamento: excecoesSemAfastamento,
      itens: excecoesOntem.slice(0, ITENS_POR_SECAO),
    },
    escalaSemViagem: { ituranSemDadosOntem, total: semViagem.length, itens: semViagem.slice(0, ITENS_POR_SECAO) },
    cartoes: cartoesItens.slice(0, ITENS_POR_SECAO),
    integracoes,
    manutencao: manutencao.slice(0, ITENS_POR_SECAO),
    manutencaoSofit,
    afastadosHoje,
  };
}
