import { addDays, addMonths, format, startOfMonth } from "date-fns";
import { prisma } from "@/lib/prisma";
import {
  workedMinutes,
  overtimeMinutes,
  findInterjornadaViolations,
  findMissingIntervalViolations,
  parsePunches,
  MIN_INTERJORNADA_MINUTES,
  REGIME_12X36_REST_MINUTES,
  STANDARD_DAILY_MINUTES,
  type PunchPair,
} from "@/lib/pontoCompliance";
import { driverDailyLimitMinutes, driverRegime12x36 } from "@/lib/convencao";
import type { Prisma, TimeClockEntry } from "@prisma/client";

// Pares entrada/saida reais do dia, pro drill-down por dia no relatorio
// mensal. Reusa `punches` (importacao TiqueTaque com 2+ pausas) quando
// presente; senao reconstroi a partir de clockIn/intervalo*/clockOut
// (lancamento manual ou importacao de 1 pausa so) — mesma logica de
// precedencia ja usada em `workedMinutes`.
function resolveDayPairs(entry: TimeClockEntry): PunchPair[] {
  const punches = parsePunches(entry.punches);
  if (punches.length > 0) return punches;
  if (entry.intervaloInicio && entry.intervaloFim) {
    return [
      { entrada: entry.clockIn, saida: entry.intervaloInicio },
      { entrada: entry.intervaloFim, saida: entry.clockOut },
    ];
  }
  return [{ entrada: entry.clockIn, saida: entry.clockOut }];
}

type DriverWithConvencoes = Prisma.DriverGetPayload<{
  include: { sindicato: { include: { convencoes: { include: { regras: true } } } } };
}>;

export type MonthlyDayCell = {
  date: Date;
  dayKey: string; // yyyy-MM-dd
  minutes: number;
  overtime: boolean;
  overtimeMinutes: number;
  hasEntry: boolean;
  open: boolean; // turno ainda em aberto (ultimo par sem saida)
  // Turno com descanso insuficiente antes dele (art. 235-C §4 CLT / regime
  // 12x36) ou sem intervalo intrajornada registrado apesar de >=6h (art. 71
  // CLT) — mesmos dois checks ja usados em /ponto e /ponto/analise,
  // reaproveitados aqui pra destacar o dia com uma cor diferente.
  interjornadaViolation: boolean;
  missingInterval: boolean;
  // Registros brutos do dia (normalmente 1) — usado pra exportacao
  // detalhada, que mostra os pares entrada/saida reais, no formato nativo
  // do TiqueTaque.
  entries: TimeClockEntry[];
  // Pares entrada/saida ja resolvidos (ver resolveDayPairs) — usado pelo
  // drill-down por dia em /ponto/mensal.
  punchPairs: PunchPair[];
};

export type MonthlyWeekStrip = {
  label: string; // "01/08–07/08" ou "29/08–31/08" (semana parcial no inicio/fim do mes)
  partial: boolean; // true quando a semana tem menos de 7 dias reais do mes
  subtotalMinutes: number;
  // Soma so da hora extra (nao do total trabalhado) da semana — alimenta a
  // visao "Horas extras" da pagina, alternativa a "Horas totais"
  // (subtotalMinutes) ja existente.
  subtotalOvertimeMinutes: number;
  // Grade fixa Domingo(0)..Sabado(6) — null nas posicoes fora do mes (inicio
  // da primeira semana / fim da ultima), ver buildWeekGrid.
  days: (MonthlyDayCell | null)[];
};

export type DriverMonthlyReport = {
  driverId: string;
  driverName: string;
  driverCpf: string;
  totalMinutes: number;
  totalOvertimeMinutes: number;
  dailyLimitMinutes: number;
  weeks: MonthlyWeekStrip[];
};

// Semanas reais do calendario, Domingo(coluna 0) a Sabado(coluna 6) — pedido
// explicito do usuario pra manter sempre essa ordem de colunas, mesmo
// sabendo que isso pode gerar uma 1a/ultima linha parcial e, em alguns
// meses, ate 6 linhas (ex.: agosto/2026, que comeca num sabado). Posicoes
// fora do mes (antes do dia 1 ou depois do ultimo dia) ficam null — a
// coluna nunca muda de dia da semana entre uma linha e outra.
function buildWeekGrid(monthStart: Date, monthEndExclusive: Date): (Date | null)[][] {
  const weeks: (Date | null)[][] = [];
  let cursor = monthStart;
  let week: (Date | null)[] = new Array(monthStart.getDay()).fill(null);
  while (cursor < monthEndExclusive) {
    week.push(cursor);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
    cursor = addDays(cursor, 1);
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

function buildDriverReport(
  driver: DriverWithConvencoes,
  weekGrid: (Date | null)[][],
  entriesByDay: Map<string, TimeClockEntry[]>,
  violatedEntryIds: Set<string>,
  missingIntervalEntryIds: Set<string>
): DriverMonthlyReport {
  const limit = driverDailyLimitMinutes(driver);
  let totalMinutes = 0;
  let totalOvertimeMinutes = 0;

  const weeks: MonthlyWeekStrip[] = weekGrid.map((weekSlots) => {
    let subtotal = 0;
    let subtotalOvertime = 0;
    const realDays = weekSlots.filter((d): d is Date => d !== null);
    const partial = realDays.length < 7;
    const label =
      realDays.length > 1
        ? `${format(realDays[0], "dd/MM")}–${format(realDays[realDays.length - 1], "dd/MM")}`
        : format(realDays[0], "dd/MM");

    const days = weekSlots.map((date): MonthlyDayCell | null => {
      if (!date) return null;
      const dayKey = format(date, "yyyy-MM-dd");
      const dayEntries = entriesByDay.get(`${driver.id}_${dayKey}`) ?? [];
      const workedList = dayEntries.map((e) => workedMinutes(e));
      const minutes = workedList.reduce((sum: number, m) => sum + (m ?? 0), 0);
      subtotal += minutes;
      const extra = overtimeMinutes(minutes, limit?.minutes);
      totalOvertimeMinutes += extra;
      subtotalOvertime += extra;
      return {
        date,
        dayKey,
        minutes,
        overtime: extra > 0,
        overtimeMinutes: extra,
        hasEntry: dayEntries.length > 0,
        open: workedList.some((m) => m === null),
        interjornadaViolation: dayEntries.some((e) => violatedEntryIds.has(e.id)),
        missingInterval: dayEntries.some((e) => missingIntervalEntryIds.has(e.id)),
        entries: dayEntries,
        punchPairs: dayEntries[0] ? resolveDayPairs(dayEntries[0]) : [],
      };
    });

    totalMinutes += subtotal;
    return { label, partial, subtotalMinutes: subtotal, subtotalOvertimeMinutes: subtotalOvertime, days };
  });

  return {
    driverId: driver.id,
    driverName: driver.name,
    driverCpf: driver.cpf,
    totalMinutes,
    totalOvertimeMinutes,
    dailyLimitMinutes: limit?.minutes ?? STANDARD_DAILY_MINUTES,
    weeks,
  };
}

export async function buildMonthlyReport(
  companyId: string,
  monthAnchor: Date
): Promise<DriverMonthlyReport[]> {
  const monthStart = startOfMonth(monthAnchor);
  const monthEnd = startOfMonth(addMonths(monthAnchor, 1)); // exclusivo

  const [drivers, entriesInMonth, entriesWithLookback] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId, active: true },
      orderBy: { name: "asc" },
      include: { sindicato: { include: { convencoes: { include: { regras: true } } } } },
    }),
    prisma.timeClockEntry.findMany({ where: { companyId, date: { gte: monthStart, lt: monthEnd } } }),
    // Inclui o dia anterior ao inicio do mes pra detectar uma violacao de
    // interjornada que comeca no ultimo turno do mes passado — mesmo padrao
    // ja usado em /ponto e /ponto/analise.
    prisma.timeClockEntry.findMany({
      where: { companyId, date: { gte: addDays(monthStart, -1), lt: monthEnd } },
    }),
  ]);

  const regime12x36ByDriver = new Map(drivers.map((d) => [d.id, driverRegime12x36(d)]));
  const violations = findInterjornadaViolations(
    entriesWithLookback,
    (driverId) => (regime12x36ByDriver.get(driverId)?.ativo ? REGIME_12X36_REST_MINUTES : MIN_INTERJORNADA_MINUTES)
  );
  const entryIdsInMonth = new Set(entriesInMonth.map((e) => e.id));
  const violatedEntryIds = new Set(violations.filter((v) => entryIdsInMonth.has(v.nextEntryId)).map((v) => v.nextEntryId));
  const missingIntervalEntryIds = new Set(findMissingIntervalViolations(entriesInMonth).map((v) => v.entryId));

  const entriesByDay = new Map<string, TimeClockEntry[]>();
  for (const e of entriesInMonth) {
    const key = `${e.driverId}_${format(e.date, "yyyy-MM-dd")}`;
    const list = entriesByDay.get(key) ?? [];
    list.push(e);
    entriesByDay.set(key, list);
  }

  const weekGrid = buildWeekGrid(monthStart, monthEnd);

  return drivers.map((driver) =>
    buildDriverReport(driver, weekGrid, entriesByDay, violatedEntryIds, missingIntervalEntryIds)
  );
}
