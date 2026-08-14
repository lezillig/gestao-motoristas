import { addDays, addMonths, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
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
  label: string; // "01/08–02/08 (semana parcial)" ou "03/08–09/08"
  partial: boolean;
  subtotalMinutes: number;
  // 7 posicoes (segunda a domingo) — null = dia fora do mes, celula em branco.
  days: (MonthlyDayCell | null)[];
};

export type DriverMonthlyReport = {
  driverId: string;
  driverName: string;
  totalMinutes: number;
  weeks: MonthlyWeekStrip[];
};

// Grade de semanas segunda-domingo cobrindo o mes inteiro (do dia 1 ao ultimo
// dia) — a primeira e a ultima semana ficam "parciais" quando o mes nao
// comeca numa segunda ou nao termina num domingo; os dias de fora do mes
// nessas semanas ficam como celula null (em branco), nunca com dado de outro
// mes.
function buildWeekGrid(monthStart: Date, monthEndExclusive: Date) {
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const weeks: Date[][] = [];
  let cursor = gridStart;
  while (cursor < monthEndExclusive) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

function buildDriverReport(
  driver: DriverWithConvencoes,
  weekGrid: Date[][],
  monthStart: Date,
  entriesByDay: Map<string, TimeClockEntry[]>,
  violatedEntryIds: Set<string>,
  missingIntervalEntryIds: Set<string>
): DriverMonthlyReport {
  const limit = driverDailyLimitMinutes(driver);
  let totalMinutes = 0;

  const weeks: MonthlyWeekStrip[] = weekGrid.map((weekDays) => {
    let subtotal = 0;
    const inMonthDates = weekDays.filter((d) => isSameMonth(d, monthStart));
    const partial = inMonthDates.length < 7;
    const label = partial
      ? `${format(inMonthDates[0], "dd/MM")}${
          inMonthDates.length > 1 ? `–${format(inMonthDates[inMonthDates.length - 1], "dd/MM")}` : ""
        } (semana parcial)`
      : `${format(weekDays[0], "dd/MM")}–${format(weekDays[6], "dd/MM")}`;

    const days = weekDays.map((date): MonthlyDayCell | null => {
      if (!isSameMonth(date, monthStart)) return null;
      const dayKey = format(date, "yyyy-MM-dd");
      const dayEntries = entriesByDay.get(`${driver.id}_${dayKey}`) ?? [];
      const workedList = dayEntries.map((e) => workedMinutes(e));
      const minutes = workedList.reduce((sum: number, m) => sum + (m ?? 0), 0);
      subtotal += minutes;
      const extra = overtimeMinutes(minutes, limit?.minutes);
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

  return { driverId: driver.id, driverName: driver.name, totalMinutes, weeks };
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
    buildDriverReport(driver, weekGrid, monthStart, entriesByDay, violatedEntryIds, missingIntervalEntryIds)
  );
}
