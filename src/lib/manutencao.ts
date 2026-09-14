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

// Unico lugar que define o que conta como "corretiva" — tela, assistente e
// auditoria usam este mesmo conjunto pra nunca discordarem.
export const TIPOS_CORRETIVOS = new Set(["corrective", "breakdown", "accident"]);
export const ehCorretiva = (tipo: string | null | undefined) => TIPOS_CORRETIVOS.has(tipo ?? "");
// Intervalo em dias abaixo disso nao e revisao, e configuracao errada na
// Sofit (visto real: "10 dias" em dezenas de veiculos, o que sozinho poria
// a frota inteira como "plano vencido") — ignorado no criterio por dias.
export const INTERVALO_DIAS_MINIMO_PLAUSIVEL = 30;
// Van/micro-onibus de fretamento nao roda mais que isso num dia; acima, o
// hodometro da revisao (ou o atual) esta errado — visto real: "21.938 km em
// 16 dias". Nesse caso o criterio de km e descartado (fica so o de dias) e o
// veiculo vai pra auditoria ("revisao_km_incoerente").
export const KM_POR_DIA_MAXIMO_PLAUSIVEL = 700;

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
  kmIncoerente: boolean;
  disponibilidade: string | null;
};

export type ManutencaoMes = { mes: string; total: number; corretivas: number; preventivas: number; externas: number; diasParado: number };
export type CausaCorretiva = { categoria: string; os: number; veiculos: number; diasParado: number; exemplos: string[] };

// Categorias de causa a partir do texto livre do problema — pra atacar a
// corretiva pela raiz (meta do usuario, 2026-09-13: reduzir ao maximo o
// numero de OS corretivas). Palavras vistas na propria base: troca, revisao,
// pneus, freio, elevador, vazamento, porta, ar condicionado, partida...
// Ordem importa: a primeira que casar vence. "Revisão / inspeção" vem antes
// de tudo porque uma OS "REVISÃO ESCOLAR"/"REVISÃO EMTU" aberta como
// corretiva (confirmado real: ~30 das 117 "Outros" de 90 dias) e, na
// verdade, preventiva/inspecao classificada errado — vira item de cobranca
// (ver auditoria "revisao_como_corretiva"), nao causa de quebra.
export const CATEGORIA_REVISAO = "Revisão / inspeção (aberta como corretiva)";
// Ordem (revisada apos code review, 2026-09-13): componentes ESPECIFICOS
// primeiro, pra "REVISÃO DOS FREIOS - PASTILHA GASTA" cair em Freios e
// "AR CONDICIONADO FRACO" em Ar-condicionado; Revisão so pega o que sobrou
// sem componente (REVISÃO ESCOLAR, REVISÃO EMTU, troca de óleo); Motor, que
// tem termos genericos (FRACO, FALHA), fica por ultimo.
const CATEGORIAS_CAUSA: [string, RegExp][] = [
  ["Sinistro / avaria externa", /ACIDENTE|COLIS[AÃ]O|BATIDA|SINISTRO|AVARIA|PEDRADA|ENCALHADO|GUINCHO|VANDAL|ROUBO|FURTO/],
  ["Freios", /FREIO|PASTILHA|DISCO DE|LONA|TAMBOR|CU[IÍ]CA/],
  ["Pneus / rodas", /PNEU|RODA(?!R)|ALINH|BALANC|ESTEPE|PRISIONEIRO|CALOTA/],
  ["Elevador / acessibilidade", /ELEVAD[D]?OR|PLATAFORMA|CADEIRA|RAMPA|CINTO/],
  ["Ar-condicionado / ventilação", /AR\s*COND|CLIMATIZ|CONDICIONADO|VENTILA/],
  ["Elétrica / bateria / partida", /BATERIA|EL[EÉ]TRIC|PARTIDA|ALTERNADOR|GERADOR|FAROL|L[AÂ]MPADA|LANTERNA|LUZ\b|CHICOTE|FIA[CÇ][AÃ]O|FIO ROMPIDO|FUS[IÍ]VEL|PAINEL|SOQUETE|CHAVE DE SETA|BUZINA/],
  ["Suspensão / direção / transmissão", /SUSPEN[SÇ]|AMORTEC|MOLA|DIRE[CÇ][AÃ]O|BUCHA|PIV[OÔ]|BANDEJA|ROLAMENTO|HOMOCIN|HEMOCIN|EIXO|C[AÂ]MBIO|EMBREAGEM|MARCHA|DIFERENCIAL|CARD[AÃ]|VOLANTE/],
  ["Vidros / limpador / retrovisores", /PARA-?\s?BRISA|BARA BRISA|VIDRO|JANELA|VIGIA|LIMPADOR|PALHETA|RETROVISOR/],
  ["Portas / lataria / interior", /PORTA|LATARIA|FUNILARIA|FUNELARIA|PINTURA|PARA-?CHOQUE|ADESIV|INSUFILME|BANCO|ESTRIBO|ARM[AÁ]RIO|ESTRUTURA|BAND[OÔ]|INVERNIZ|DELINEAR|CORTINA|ASSOALHO|TETO/],
  ["Chaves / travas", /CHAVE|TRAVA|FECHADURA|CANIVETE/],
  ["Tacógrafo / equipamentos", /TAC[OÓ]GRAFO|RASTREADOR|C[AÂ]MERA|MONITOR|R[AÁ]DIO/],
  ["Vazamentos", /VAZAMENTO|VAZANDO/],
  [CATEGORIA_REVISAO, /REVIS[AÃ]O|REVISAO|PREVENTIVA|INSPE[CÇ][AÃ]O|VISTORIA|EMTU|ESCOLAR|CVS|ARTESP|DETRAN|TROCA DE [OÓ]LEO/],
  ["Motor / injeção / potência", /MOTOR|[OÓ]LEO|CORREIA|FILTRO|ARREFEC|RADIADOR|SUPERAQUEC|VELA|INJE[CÇ]|BICO|TURBINA|INTERCOOLER|ARLA|REGENERA|FRACO|SEM (POT[EÊ]NCIA|FOR[CÇ]A|ACELERA)|PERDEU (A )?FOR[CÇ]A|N[AÃ]O PEGA|MORRENDO|DESLIGA|FUMA[CÇ]A|FALHA(NDO)?|ESCAPAMENTO|TANQUE|MANGUEIRA|COMBUST[IÍ]VEL|DIESEL|[AÁ]GUA (BAIXANDO|DO RESERVAT)|COMPRES[S]?OR/],
];
export function categoriaCausa(problema: string | null): string {
  const p = (problema ?? "").toUpperCase();
  for (const [nome, re] of CATEGORIAS_CAUSA) if (re.test(p)) return nome;
  return p.trim() ? "Outros" : "Sem descrição";
}
export type Reincidente = { plate: string; os: number; diasParado: number; problemas: string[] };
export type Fornecedor = { nome: string; os: number; diasParadoMedio: number };
export type Vencimento = { plate: string; tipo: string; venceEm: Date; dias: number; recorrencia: string | null };

export type Manutencao = {
  ultimaSync: Date | null;
  frota: { total: number; disponiveis: number; emManutencao: number; emUso: number; inativos: number; semSofit: number };
  frotaListas: { disponiveis: string[]; emUso: string[]; emManutencao: string[]; semStatus: string[] };
  parados: { plate: string; modelo: string; osAberta: OsAberta | null }[];
  backlog: { porStatus: Record<string, number>; total: number; itens: OsAberta[]; antigas: number; aprovacaoAtrasada: number };
  aderencia: { itens: AderenciaVeiculo[]; vencidas: number; breve: number; emDia: number; semHistorico: number };
  mensal: ManutencaoMes[];
  causas: CausaCorretiva[];
  corretivasPorVeiculo: { mesAtual: number | null; mesAnterior: number | null };
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
  const placas = (d: string | null) => comSofit.filter((v) => v.sofitDisponibilidade === d).map((v) => v.plate);
  const frotaListas = {
    disponiveis: placas("available"),
    emUso: placas("inUse"),
    emManutencao: placas("inMaintenance"),
    semStatus: comSofit.filter((v) => !v.sofitDisponibilidade || !["available", "inUse", "inMaintenance"].includes(v.sofitDisponibilidade)).map((v) => v.plate),
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
      // Km so conta com hodometro atual conhecido (>0) e coerente com a ultima
      // revisao (nao negativo — hodometro da revisao maior que o atual e dado
      // errado, apontado na auditoria, nao "plano vencido").
      let kmDesde = v.lastMaintenanceMileage > 0 && kmAtual > 0 && kmAtual >= v.lastMaintenanceMileage ? kmAtual - v.lastMaintenanceMileage : null;
      const diasDesde = v.ultimaManutencaoEm ? differenceInCalendarDays(now, v.ultimaManutencaoEm) : null;
      const kmIncoerente = kmDesde != null && diasDesde != null && kmDesde / Math.max(1, diasDesde) > KM_POR_DIA_MAXIMO_PLAUSIVEL;
      if (kmIncoerente) kmDesde = null;
      const intervaloDiasValido = v.manutencaoIntervaloDias && v.manutencaoIntervaloDias >= INTERVALO_DIAS_MINIMO_PLAUSIVEL ? v.manutencaoIntervaloDias : null;
      const pctKm = kmDesde != null ? kmDesde / intervaloKm : null;
      const pctDias = diasDesde != null && intervaloDiasValido ? diasDesde / intervaloDiasValido : null;
      const pct = pctKm != null || pctDias != null ? Math.max(pctKm ?? 0, pctDias ?? 0) : null;
      const situacao: AderenciaVeiculo["situacao"] = !temHistorico || pct == null ? "sem_historico" : pct >= 1 ? "vencida" : pct >= 0.8 ? "breve" : "em_dia";
      return {
        vehicleId: v.id,
        plate: v.plate,
        modelo: `${v.brand} ${v.model}`.trim(),
        kmAtual,
        intervaloKm,
        intervaloDias: intervaloDiasValido,
        ultimaKm: v.lastMaintenanceMileage > 0 ? v.lastMaintenanceMileage : null,
        ultimaEm: v.ultimaManutencaoEm,
        kmDesde,
        diasDesde,
        pct,
        situacao,
        kmIncoerente,
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

  // --- Causas das corretivas (90 dias) e corretivas por veiculo ativo ---
  const plateById = new Map(vehicles.map((v) => [v.id, v.plate]));
  const porCausa = new Map<string, { os: number; veiculos: Set<string>; diasParado: number; exemplos: Map<string, number> }>();
  for (const o of osRecentes) {
    if (o.criadaEm < inicio90 || !TIPOS_CORRETIVOS.has(o.tipo ?? "")) continue;
    const cat = categoriaCausa(o.problema);
    const acc = porCausa.get(cat) ?? { os: 0, veiculos: new Set(), diasParado: 0, exemplos: new Map() };
    acc.os++;
    acc.diasParado += o.diasParado ?? 0;
    const plate = (o.vehicleId && plateById.get(o.vehicleId)) || o.placaOriginal || "?";
    acc.veiculos.add(plate);
    acc.exemplos.set(plate, (acc.exemplos.get(plate) ?? 0) + 1);
    porCausa.set(cat, acc);
  }
  const causas: CausaCorretiva[] = [...porCausa.entries()]
    .map(([categoria, a]) => ({
      categoria,
      os: a.os,
      veiculos: a.veiculos.size,
      diasParado: Math.round(a.diasParado),
      exemplos: [...a.exemplos.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([p, n]) => (n > 1 ? `${p} (${n})` : p)),
    }))
    .sort((a, b) => b.os - a.os);
  const frotaAtiva = Math.max(1, comSofit.length);
  const mesAtualRow = meses[meses.length - 1];
  const mesAnteriorRow = meses[meses.length - 2];
  const corretivasPorVeiculo = {
    mesAtual: mesAtualRow ? Math.round((mesAtualRow.corretivas / frotaAtiva) * 100) / 100 : null,
    mesAnterior: mesAnteriorRow ? Math.round((mesAnteriorRow.corretivas / frotaAtiva) * 100) / 100 : null,
  };

  // --- Reincidentes e fornecedores (90 dias) ---
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
    frotaListas,
    parados,
    backlog: { porStatus, total: abertas.length, itens: abertas, antigas, aprovacaoAtrasada },
    aderencia,
    mensal: meses,
    causas,
    corretivasPorVeiculo,
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
