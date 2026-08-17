import { addDays, endOfMonth } from "date-fns";
import { prisma } from "@/lib/prisma";
import {
  workedMinutes,
  overtimeMinutes,
  REGIME_12X36_WORK_MINUTES,
  REGIME_12X36_REST_MINUTES,
  MIN_INTERJORNADA_MINUTES,
  findInterjornadaViolations,
  findMissingWeeklyRestViolations,
  type PontoEntryLike,
} from "@/lib/pontoCompliance";
import { driverDailyLimitMinutes, driverRegime12x36, resolveRegra, HORA_EXTRA_PERCENTUAL_MINIMO } from "@/lib/convencao";

// Simulador de cenario: reusa o MESMO motor de calculo ja usado em
// /ponto/analise e /ponto/passivo, so trocando os PARAMETROS de entrada
// (limite diario, regime 12x36, teto de dias corridos, valor-hora) por uma
// hipotese em vez do que esta realmente configurado no cadastro do
// motorista — nunca inventa jornada, usa as batidas reais do mes escolhido.
// Objetivo: decidir ANTES de mudar (ex.: "se eu mover esse motorista pra
// 12x36, o custo de hora extra desse mes teria sido maior ou menor, e a
// interjornada teria violado menos vezes?").

export type RegimeSimulado = "atual" | "padrao" | "doze_x_trinta_seis";
export type EscalaSimulada = "atual" | "sem_limite" | "seis_um" | "cinco_dois";

export type SimulationInput = {
  regime: RegimeSimulado;
  escala: EscalaSimulada;
  // null = usa o valor real cadastrado do motorista.
  valorHoraCents: number | null;
  // Em minutos; null = usa o limite diario real resolvido (CCT/ACT/regime).
  limiteDiarioMinutosOverride: number | null;
};

export type SimulationScenarioResult = {
  dailyLimitMinutes: number;
  regime12x36Ativo: boolean;
  maxConsecutiveDays: number;
  overtimeMinutes: number;
  overtimeCostCents: number | null;
  interjornadaCount: number;
  interjornadaCostCents: number;
  dsrCount: number;
  dsrCostCents: number;
  totalCostCents: number | null;
};

export type SimulationReport = {
  driverId: string;
  driverName: string;
  hasValorHora: boolean;
  atual: SimulationScenarioResult;
  simulado: SimulationScenarioResult;
};

const INDEMNITY_PERCENTUAL = 0.5;

function runScenario(
  entriesInMonth: PontoEntryLike[],
  entriesWithLookback: PontoEntryLike[],
  entryIdsInMonth: Set<string>,
  dailyLimitMinutes: number,
  regime12x36Ativo: boolean,
  maxConsecutiveDays: number,
  valorHoraCents: number | null,
  hourExtraPercent: number
): SimulationScenarioResult {
  const effectiveLimit = regime12x36Ativo ? REGIME_12X36_WORK_MINUTES : dailyLimitMinutes;

  let overtime = 0;
  for (const entry of entriesInMonth) overtime += overtimeMinutes(workedMinutes(entry), effectiveLimit);
  const overtimeCostCents = valorHoraCents != null ? Math.round((overtime / 60) * valorHoraCents * (1 + hourExtraPercent / 100)) : null;

  const requiredRest = regime12x36Ativo ? REGIME_12X36_REST_MINUTES : MIN_INTERJORNADA_MINUTES;
  const interjornadaViol = findInterjornadaViolations(entriesWithLookback, () => requiredRest).filter((v) =>
    entryIdsInMonth.has(v.nextEntryId)
  );
  let interjornadaCostCents = 0;
  for (const v of interjornadaViol) {
    const missing = Math.max(0, requiredRest - v.gapMinutes);
    if (valorHoraCents != null) interjornadaCostCents += Math.round((missing / 60) * valorHoraCents * INDEMNITY_PERCENTUAL);
  }

  const dsrViol = findMissingWeeklyRestViolations(entriesWithLookback, () => maxConsecutiveDays).filter((v) =>
    entryIdsInMonth.has(v.entryId)
  );
  const dsrDailyMinutes = regime12x36Ativo ? REGIME_12X36_WORK_MINUTES : dailyLimitMinutes;
  let dsrCostCents = 0;
  if (valorHoraCents != null) dsrCostCents = dsrViol.length * Math.round((dsrDailyMinutes / 60) * valorHoraCents);

  const totalCostCents = valorHoraCents != null ? (overtimeCostCents ?? 0) + interjornadaCostCents + dsrCostCents : null;

  return {
    dailyLimitMinutes: effectiveLimit,
    regime12x36Ativo,
    maxConsecutiveDays,
    overtimeMinutes: overtime,
    overtimeCostCents,
    interjornadaCount: interjornadaViol.length,
    interjornadaCostCents,
    dsrCount: dsrViol.length,
    dsrCostCents,
    totalCostCents,
  };
}

export async function buildSimulationReport(
  companyId: string,
  driverId: string,
  monthStart: Date,
  input: SimulationInput
): Promise<SimulationReport | null> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId, companyId },
    include: { sindicato: { include: { convencoes: { include: { regras: true } } } } },
  });
  if (!driver) return null;

  const monthEnd = addDays(endOfMonth(monthStart), 1);
  const entriesWithLookback = await prisma.timeClockEntry.findMany({
    where: { companyId, driverId, date: { gte: addDays(monthStart, -7), lt: monthEnd } },
  });
  const entriesInMonth = entriesWithLookback.filter((e) => e.date >= monthStart && e.date < monthEnd);
  const entryIdsInMonth = new Set(entriesInMonth.map((e) => e.id));

  const realLimit = driverDailyLimitMinutes(driver);
  const realRegime = driverRegime12x36(driver);
  const realMaxConsecutive = driver.escalaSemanal === "SEIS_UM" ? 6 : driver.escalaSemanal === "CINCO_DOIS" ? 5 : 7;
  const hourExtraRegra = resolveRegra(driver, "HORA_EXTRA");
  const hourExtraPercent = hourExtraRegra.valorNumerico ?? HORA_EXTRA_PERCENTUAL_MINIMO;

  const atual = runScenario(
    entriesInMonth,
    entriesWithLookback,
    entryIdsInMonth,
    realLimit.minutes,
    realRegime.ativo,
    realMaxConsecutive,
    driver.valorHoraCents,
    hourExtraPercent
  );

  const simRegimeAtivo = input.regime === "atual" ? realRegime.ativo : input.regime === "doze_x_trinta_seis";
  const simMaxConsecutive =
    input.escala === "atual"
      ? realMaxConsecutive
      : input.escala === "seis_um"
        ? 6
        : input.escala === "cinco_dois"
          ? 5
          : 7;
  const simDailyLimit = input.limiteDiarioMinutosOverride ?? realLimit.minutes;
  const simValorHora = input.valorHoraCents ?? driver.valorHoraCents;

  const simulado = runScenario(
    entriesInMonth,
    entriesWithLookback,
    entryIdsInMonth,
    simDailyLimit,
    simRegimeAtivo,
    simMaxConsecutive,
    simValorHora,
    hourExtraPercent
  );

  return { driverId: driver.id, driverName: driver.name, hasValorHora: !!driver.valorHoraCents, atual, simulado };
}
