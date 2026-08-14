import { addDays, addMonths, format, startOfMonth } from "date-fns";
import { prisma } from "@/lib/prisma";
import {
  workedMinutes,
  overtimeMinutes,
  findInterjornadaViolations,
  findMissingIntervalViolations,
  MIN_INTERJORNADA_MINUTES,
  REGIME_12X36_REST_MINUTES,
} from "@/lib/pontoCompliance";
import { driverDailyLimitMinutes, driverRegime12x36 } from "@/lib/convencao";
import type { Prisma, TimeClockEntry } from "@prisma/client";

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
};

export type MonthlyWeekStrip = {
  label: string; // "01/08–07/08" ou "29/08–31/08" (ultima, com menos de 7 dias)
  partial: boolean; // true so na ultima semana quando o mes nao fecha em multiplo de 7
  subtotalMinutes: number;
  // Sempre dias reais do mes (nunca null) — ver comentario em buildWeekGrid.
  days: MonthlyDayCell[];
};

export type DriverMonthlyReport = {
  driverId: string;
  driverName: string;
  totalMinutes: number;
  totalOvertimeMinutes: number;
  weeks: MonthlyWeekStrip[];
};

// Blocos fixos de 7 dias a partir do dia 1 do mes (dia 1-7, 8-14, 15-21,
// 22-28, 29-ate o fim) — deliberadamente NAO alinhado ao calendario
// segunda-domingo. Um mes de 31 dias comecando proximo do fim de uma semana
// (ex.: agosto/2026, que comeca num sabado) geraria uma 6a linha se a grade
// fosse alinhada ao calendario (confirmado com o usuario, que preferiu no
// maximo 5 blocos a manter o alinhamento por dia da semana). Cada dia dentro
// do bloco continua mostrando seu proprio dia da semana real (EEE) na celula
// — so a POSICAO da coluna deixa de corresponder sempre ao mesmo dia da
// semana entre um bloco e outro.
function buildWeekGrid(monthStart: Date, monthEndExclusive: Date) {
  const weeks: Date[][] = [];
  let cursor = monthStart;
  while (cursor < monthEndExclusive) {
    const days: Date[] = [];
    for (let i = 0; i < 7 && cursor < monthEndExclusive; i++) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(days);
  }
  return weeks;
}

function buildDriverReport(
  driver: DriverWithConvencoes,
  weekGrid: Date[][],
  entriesByDay: Map<string, TimeClockEntry[]>,
  violatedEntryIds: Set<string>,
  missingIntervalEntryIds: Set<string>
): DriverMonthlyReport {
  const limit = driverDailyLimitMinutes(driver);
  let totalMinutes = 0;
  let totalOvertimeMinutes = 0;

  const weeks: MonthlyWeekStrip[] = weekGrid.map((weekDays) => {
    let subtotal = 0;
    const partial = weekDays.length < 7;
    const label =
      weekDays.length > 1
        ? `${format(weekDays[0], "dd/MM")}–${format(weekDays[weekDays.length - 1], "dd/MM")}`
        : format(weekDays[0], "dd/MM");

    const days = weekDays.map((date): MonthlyDayCell => {
      const dayKey = format(date, "yyyy-MM-dd");
      const dayEntries = entriesByDay.get(`${driver.id}_${dayKey}`) ?? [];
      const workedList = dayEntries.map((e) => workedMinutes(e));
      const minutes = workedList.reduce((sum: number, m) => sum + (m ?? 0), 0);
      subtotal += minutes;
      const extra = overtimeMinutes(minutes, limit?.minutes);
      totalOvertimeMinutes += extra;
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
      };
    });

    totalMinutes += subtotal;
    return { label, partial, subtotalMinutes: subtotal, days };
  });

  return { driverId: driver.id, driverName: driver.name, totalMinutes, totalOvertimeMinutes, weeks };
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
