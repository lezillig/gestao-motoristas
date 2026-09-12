import { differenceInCalendarDays, subMonths } from "date-fns";
import { prisma } from "@/lib/prisma";
import { brazilDayLabel, brazilMidnightUtc } from "@/lib/date";
import { cnhAlertLevel, requiresCnh, type CnhAlertLevel } from "@/lib/driverAlerts";
import {
  EXCESSIVE_OVERTIME_MINUTES,
  MIN_INTERJORNADA_MINUTES,
  REGIME_12X36_REST_MINUTES,
  STANDARD_DAILY_MINUTES,
  findAbsences,
  findInterjornadaViolations,
  workedMinutes,
  type PontoEntryLike,
} from "@/lib/pontoCompliance";
import { SPEED_LIMIT_KMH } from "@/lib/speedCompliance";

export const RISCO_JANELAS_DIAS = [30, 60, 90] as const;
export const RISCO_JANELA_PADRAO_DIAS = 30;

// CTB art. 261 (redacao da Lei 14.071/2020): quem exerce atividade
// remunerada (EAR, caso de todo motorista de fretamento) tem a CNH suspensa
// ao somar 40 pontos em 12 meses, independente da gravidade. Alerta bem
// antes disso. Os pontos aqui sao os das multas ATRIBUIDAS neste sistema
// (IndicacaoCondutor), nao o prontuario oficial do DETRAN — a LW nao expoe
// prontuario (conferido no guia da API, 2026-09-11).
export const PONTOS_CNH_JANELA_MESES = 12;
export const PONTOS_CNH_SUSPENSAO_EAR = 40;
export const PONTOS_CNH_ATENCAO = 20;
export const VELOCIDADE_GRAVE_KMH = 120;
// Jornada normal (8h) + o limite de hora extra que ja tratamos como
// "excessiva" em /ponto/analise (2h) — um dia acima disso e sinal de fadiga.
export const DIA_LONGO_MINUTOS = STANDARD_DAILY_MINUTES + EXCESSIVE_OVERTIME_MINUTES;

export type NivelRisco = "alto" | "medio" | "baixo";

export type RiscoMotorista = {
  driverId: string;
  driverName: string;
  funcao: string | null;
  score: number;
  nivel: NivelRisco;
  motivos: string[];
  cnh: { nivel: CnhAlertLevel; expiration: Date | null; dias: number | null };
  multas: { total: number; valorCents: number; pontos12m: number };
  conducao: { viagens: number; km: number; velocidadeMax: number | null; excessos: number; ociosoMin: number };
  ponto: { interjornada: number; diasLongos: number; regime12x36: boolean };
  faltas: number;
};

export type RiscoResumo = {
  dias: number;
  motoristas: RiscoMotorista[];
  totais: {
    alto: number;
    medio: number;
    pontosAtencao: number;
    excessos: number;
    interjornada: number;
    viagensTotal: number;
    viagensSemMotorista: number;
  };
};

function nivelDoScore(score: number): NivelRisco {
  if (score >= 60) return "alto";
  if (score >= 30) return "medio";
  return "baixo";
}

// Ranking de atencao por motorista, juntando sinais que hoje vivem em 5
// telas diferentes (CNH, Multas, Telemetria, Ponto, Escala x ponto). A
// atribuicao de viagem da Ituran ao motorista e pela Escala do SIAT
// (VehicleTrip.escalaId, casado por veiculo+dia em lib/vehicleTripEscala.ts)
// — antes so existia via check-in manual, que ninguem usa, entao o ranking
// de velocidade de /telemetria ficava vazio. O score e uma soma ponderada
// simples e explicavel (cada motivo aparece em `motivos`), nao um modelo:
// serve pra ordenar quem olhar primeiro, nao pra punir sozinho.
export async function buildRiscoMotoristas(companyId: string, dias: number, now = new Date()): Promise<RiscoResumo> {
  const hojeLabel = brazilDayLabel(0);
  const inicioLabel = brazilDayLabel(-dias);
  const inicioUtc = brazilMidnightUtc(-dias);
  const hojeUtc = brazilMidnightUtc(0);
  const inicioPontos = subMonths(now, PONTOS_CNH_JANELA_MESES);

  const [drivers, indicacoes, escalas, trips, entries, leaves] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, funcao: true, departamento: true, cnhExpiration: true, regimeHoras: true },
    }),
    prisma.indicacaoCondutor.findMany({
      where: { companyId, driverId: { not: null }, status: { not: "REJEITADA" }, multa: { dataInfracao: { gte: inicioPontos } } },
      select: { driverId: true, multa: { select: { dataInfracao: true, valorCents: true, pontuacao: true } } },
    }),
    // Ate ONTEM: hoje ainda nao fechou (ponto/viagem chegam de madrugada).
    prisma.escala.findMany({
      where: { companyId, date: { gte: inicioLabel, lt: hojeLabel } },
      select: { id: true, driverId: true, date: true },
    }),
    prisma.vehicleTrip.findMany({
      where: { companyId, startAt: { gte: inicioUtc, lt: hojeUtc } },
      select: { escalaId: true, maxSpeedKmh: true, distanceKm: true, idleMinutes: true },
    }),
    prisma.timeClockEntry.findMany({
      where: { companyId, date: { gte: inicioLabel, lt: hojeLabel } },
      select: {
        id: true,
        driverId: true,
        date: true,
        clockIn: true,
        clockOut: true,
        intervaloInicio: true,
        intervaloFim: true,
        punches: true,
      },
    }),
    prisma.driverLeave.findMany({
      where: { companyId, startDate: { lt: hojeLabel }, endDate: { gte: inicioLabel } },
      select: { driverId: true, startDate: true, endDate: true },
    }),
  ]);

  const motoristas = drivers.filter((d) => requiresCnh(d.funcao, d.departamento));
  const regime12x36 = new Set(motoristas.filter((d) => d.regimeHoras === "DOZE_X_TRINTA_SEIS").map((d) => d.id));

  // --- Multas atribuidas ---
  const multasPorDriver = new Map<string, { total: number; valorCents: number; pontos12m: number }>();
  for (const i of indicacoes) {
    if (!i.driverId) continue;
    const acc = multasPorDriver.get(i.driverId) ?? { total: 0, valorCents: 0, pontos12m: 0 };
    acc.pontos12m += i.multa.pontuacao ?? 0;
    if (i.multa.dataInfracao && i.multa.dataInfracao >= inicioLabel) {
      acc.total += 1;
      acc.valorCents += i.multa.valorCents ?? 0;
    }
    multasPorDriver.set(i.driverId, acc);
  }

  // --- Conducao (Ituran), atribuida pela escala ---
  const driverByEscalaId = new Map(escalas.map((e) => [e.id, e.driverId]));
  const conducaoPorDriver = new Map<string, RiscoMotorista["conducao"]>();
  let viagensSemMotorista = 0;
  for (const t of trips) {
    const driverId = t.escalaId ? driverByEscalaId.get(t.escalaId) : undefined;
    if (!driverId) {
      viagensSemMotorista += 1;
      continue;
    }
    const acc = conducaoPorDriver.get(driverId) ?? { viagens: 0, km: 0, velocidadeMax: null, excessos: 0, ociosoMin: 0 };
    acc.viagens += 1;
    acc.km += t.distanceKm ?? 0;
    acc.ociosoMin += t.idleMinutes ?? 0;
    if (t.maxSpeedKmh != null) {
      if (acc.velocidadeMax == null || t.maxSpeedKmh > acc.velocidadeMax) acc.velocidadeMax = t.maxSpeedKmh;
      if (t.maxSpeedKmh > SPEED_LIMIT_KMH) acc.excessos += 1;
    }
    conducaoPorDriver.set(driverId, acc);
  }

  // --- Ponto: interjornada e dias longos ---
  const pontoEntries: PontoEntryLike[] = entries;
  const interjornadaPorDriver = new Map<string, number>();
  for (const v of findInterjornadaViolations(pontoEntries, (driverId) =>
    regime12x36.has(driverId) ? REGIME_12X36_REST_MINUTES : MIN_INTERJORNADA_MINUTES
  )) {
    interjornadaPorDriver.set(v.driverId, (interjornadaPorDriver.get(v.driverId) ?? 0) + 1);
  }
  const diasLongosPorDriver = new Map<string, number>();
  for (const e of pontoEntries) {
    // 12x36 trabalha 12h por definicao — nao e dia longo.
    if (regime12x36.has(e.driverId)) continue;
    const worked = workedMinutes(e);
    if (worked != null && worked > DIA_LONGO_MINUTOS) {
      diasLongosPorDriver.set(e.driverId, (diasLongosPorDriver.get(e.driverId) ?? 0) + 1);
    }
  }

  // --- Faltas: escala sem ponto, descontando dias de afastamento ---
  const leavesPorDriver = new Map<string, { start: Date; end: Date }[]>();
  for (const l of leaves) {
    const list = leavesPorDriver.get(l.driverId) ?? [];
    list.push({ start: l.startDate, end: l.endDate });
    leavesPorDriver.set(l.driverId, list);
  }
  const escalasSemAfastamento = escalas.filter(
    (e) => !(leavesPorDriver.get(e.driverId) ?? []).some((l) => e.date >= l.start && e.date <= l.end)
  );
  const faltasPorDriver = new Map<string, number>();
  for (const a of findAbsences(escalasSemAfastamento, pontoEntries)) {
    faltasPorDriver.set(a.driverId, (faltasPorDriver.get(a.driverId) ?? 0) + 1);
  }

  // --- Score ---
  const resultado: RiscoMotorista[] = motoristas.map((d) => {
    const motivos: string[] = [];
    let score = 0;

    const cnhNivel = cnhAlertLevel(d.cnhExpiration, d.funcao, d.departamento, now);
    const cnhDias = d.cnhExpiration ? differenceInCalendarDays(d.cnhExpiration, now) : null;
    if (cnhNivel === "vencida") {
      score += 40;
      motivos.push(`CNH vencida há ${Math.abs(cnhDias ?? 0)}d`);
    } else if (cnhNivel === "vence_em_breve") {
      score += 15;
      motivos.push(`CNH vence em ${cnhDias}d`);
    } else if (cnhNivel === "pendente") {
      score += 5;
      motivos.push("CNH não cadastrada");
    }

    const multas = multasPorDriver.get(d.id) ?? { total: 0, valorCents: 0, pontos12m: 0 };
    score += multas.total * 10;
    if (multas.pontos12m >= PONTOS_CNH_SUSPENSAO_EAR) {
      score += 60;
      motivos.push(`${multas.pontos12m} pts em 12 meses — limite de suspensão (${PONTOS_CNH_SUSPENSAO_EAR})`);
    } else if (multas.pontos12m >= PONTOS_CNH_ATENCAO) {
      score += 30;
      motivos.push(`${multas.pontos12m} pts em 12 meses`);
    } else {
      score += multas.pontos12m;
    }
    if (multas.total > 0) motivos.push(`${multas.total} multa(s) no período`);

    const conducao = conducaoPorDriver.get(d.id) ?? { viagens: 0, km: 0, velocidadeMax: null, excessos: 0, ociosoMin: 0 };
    score += Math.min(conducao.excessos * 5, 40);
    if (conducao.velocidadeMax != null && conducao.velocidadeMax >= VELOCIDADE_GRAVE_KMH) score += 15;
    if (conducao.excessos > 0) {
      motivos.push(`${conducao.excessos} viagem(ns) acima de ${SPEED_LIMIT_KMH} km/h (máx. ${conducao.velocidadeMax})`);
    }

    const interjornada = interjornadaPorDriver.get(d.id) ?? 0;
    const diasLongos = diasLongosPorDriver.get(d.id) ?? 0;
    score += Math.min(interjornada * 8, 40) + Math.min(diasLongos * 3, 30);
    if (interjornada > 0) motivos.push(`${interjornada} descanso(s) entre turnos abaixo do mínimo`);
    if (diasLongos > 0) motivos.push(`${diasLongos} dia(s) com mais de ${DIA_LONGO_MINUTOS / 60}h trabalhadas`);

    const faltas = faltasPorDriver.get(d.id) ?? 0;
    score += Math.min(faltas * 4, 20);
    if (faltas > 0) motivos.push(`${faltas} dia(s) escalado sem ponto`);

    return {
      driverId: d.id,
      driverName: d.name,
      funcao: d.funcao,
      score,
      nivel: nivelDoScore(score),
      motivos,
      cnh: { nivel: cnhNivel, expiration: d.cnhExpiration, dias: cnhDias },
      multas,
      conducao: { ...conducao, km: Math.round(conducao.km) },
      ponto: { interjornada, diasLongos, regime12x36: regime12x36.has(d.id) },
      faltas,
    };
  });

  resultado.sort((a, b) => b.score - a.score || a.driverName.localeCompare(b.driverName, "pt-BR"));

  return {
    dias,
    motoristas: resultado,
    totais: {
      alto: resultado.filter((r) => r.nivel === "alto").length,
      medio: resultado.filter((r) => r.nivel === "medio").length,
      pontosAtencao: resultado.filter((r) => r.multas.pontos12m >= PONTOS_CNH_ATENCAO).length,
      excessos: resultado.reduce((s, r) => s + r.conducao.excessos, 0),
      interjornada: resultado.reduce((s, r) => s + r.ponto.interjornada, 0),
      viagensTotal: trips.length,
      viagensSemMotorista,
    },
  };
}
