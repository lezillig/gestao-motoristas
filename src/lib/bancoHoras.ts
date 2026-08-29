import { format, startOfMonth, subMonths, addMonths } from "date-fns";
import { prisma } from "@/lib/prisma";
import { workedMinutes, overtimeMinutes, REGIME_12X36_WORK_MINUTES } from "@/lib/pontoCompliance";
import { driverDailyLimitMinutes, driverRegime12x36 } from "@/lib/convencao";
import type { Prisma, TimeClockEntry, DriverLeave } from "@prisma/client";

// Sem acordo individual de banco de horas por escrito, a compensacao so e
// presumidamente valida em ate 6 meses (art. 59, §§5º-6º CLT) — usado como
// janela do saldo agregado abaixo.
export const BANCO_HORAS_WINDOW_MONTHS = 6;

type DriverWithConvencoes = Prisma.DriverGetPayload<{
  include: { sindicato: { include: { convencoes: { include: { regras: true } } } } };
}>;

export type DriverBancoHorasMonth = {
  monthKey: string; // yyyy-MM
  creditMinutes: number;
  debitMinutes: number;
  balanceMinutes: number;
};

export type DriverBancoHorasBalance = {
  driverId: string;
  creditMinutes: number;
  debitMinutes: number;
  balanceMinutes: number;
  // Mes (yyyy-MM) mais antigo da janela com credito de hora extra ainda nao
  // consumido pelo debito acumulado ate ali — usado so pra sinalizar
  // proximidade do limite de 6 meses, nao e um FIFO exato de qual credito
  // especifico ainda esta em aberto.
  oldestUnconsumedCreditMonth: string | null;
  // Saldo positivo com credito desde o mes mais antigo da janela: perto de
  // completar 6 meses sem compensacao — risco do excedente ter que ser pago
  // em vez de compensado (Sumula 85, IV, TST).
  atRisk: boolean;
  // Detalhamento mes a mes (mais antigo primeiro) — alimenta o drill-down
  // "ver por mes" na UI e o detalhe opcional na exportacao.
  monthly: DriverBancoHorasMonth[];
};

// Debito de uma folga: aproxima pelo limite diario do proprio motorista (o
// que "tirar um dia de folga" efetivamente compensa) — nao ha campo de
// horas-de-credito-usadas por folga no sistema hoje, entao esta e uma
// aproximacao deliberada, documentada aqui e na UI.
export function computeBancoHorasBalance(
  driver: DriverWithConvencoes,
  monthKeysOldestFirst: string[],
  entriesByMonth: Map<string, TimeClockEntry[]>,
  leavesByMonth: Map<string, DriverLeave[]>
): DriverBancoHorasBalance {
  const limit = driverDailyLimitMinutes(driver);
  const regime = driverRegime12x36(driver);
  const effectiveLimit = regime.ativo ? REGIME_12X36_WORK_MINUTES : limit.minutes;

  let creditMinutes = 0;
  let debitMinutes = 0;
  let oldestUnconsumedCreditMonth: string | null = null;
  let runningBalance = 0;
  const monthly: DriverBancoHorasMonth[] = [];

  for (const monthKey of monthKeysOldestFirst) {
    const entries = entriesByMonth.get(monthKey) ?? [];
    let monthCredit = 0;
    for (const entry of entries) {
      monthCredit += overtimeMinutes(workedMinutes(entry), effectiveLimit);
    }

    const leaves = leavesByMonth.get(monthKey) ?? [];
    const monthDebit = leaves.filter((l) => l.leaveType === "folga").length * effectiveLimit;

    creditMinutes += monthCredit;
    debitMinutes += monthDebit;
    runningBalance += monthCredit - monthDebit;
    monthly.push({ monthKey, creditMinutes: monthCredit, debitMinutes: monthDebit, balanceMinutes: runningBalance });

    if (monthCredit > 0 && oldestUnconsumedCreditMonth === null && runningBalance > 0) {
      oldestUnconsumedCreditMonth = monthKey;
    }
  }

  const balanceMinutes = creditMinutes - debitMinutes;
  const atRisk = balanceMinutes > 0 && oldestUnconsumedCreditMonth === monthKeysOldestFirst[0];

  return { driverId: driver.id, creditMinutes, debitMinutes, balanceMinutes, oldestUnconsumedCreditMonth, atRisk, monthly };
}

export type DriverBancoHorasRow = { driverId: string; driverName: string; balance: DriverBancoHorasBalance };

// Busca e monta o saldo de banco de horas de todos os motoristas ativos da
// empresa na janela de BANCO_HORAS_WINDOW_MONTHS — usado tanto pela tela
// quanto pela exportacao, pra nao duplicar a query/agregacao nos dois
// lugares.
export async function buildBancoHorasReport(companyId: string): Promise<DriverBancoHorasRow[]> {
  const today = new Date();
  const windowStart = startOfMonth(subMonths(today, BANCO_HORAS_WINDOW_MONTHS - 1));
  const windowEndExclusive = startOfMonth(addMonths(today, 1));

  const monthKeysOldestFirst: string[] = [];
  for (let i = BANCO_HORAS_WINDOW_MONTHS - 1; i >= 0; i--) {
    monthKeysOldestFirst.push(format(subMonths(today, i), "yyyy-MM"));
  }

  const [drivers, entries, leaves] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId, active: true },
      orderBy: { name: "asc" },
      include: { sindicato: { include: { convencoes: { include: { regras: true } } } } },
    }),
    prisma.timeClockEntry.findMany({ where: { companyId, date: { gte: windowStart, lt: windowEndExclusive } } }),
    prisma.driverLeave.findMany({ where: { companyId, startDate: { gte: windowStart, lt: windowEndExclusive } } }),
  ]);

  const entriesByDriverMonth = new Map<string, TimeClockEntry[]>();
  for (const e of entries) {
    const key = `${e.driverId}_${format(e.date, "yyyy-MM")}`;
    const list = entriesByDriverMonth.get(key) ?? [];
    list.push(e);
    entriesByDriverMonth.set(key, list);
  }
  const leavesByDriverMonth = new Map<string, DriverLeave[]>();
  for (const l of leaves) {
    const key = `${l.driverId}_${format(l.startDate, "yyyy-MM")}`;
    const list = leavesByDriverMonth.get(key) ?? [];
    list.push(l);
    leavesByDriverMonth.set(key, list);
  }

  return drivers
    .map((driver) => {
      const entriesByMonth = new Map(
        monthKeysOldestFirst.map((m) => [m, entriesByDriverMonth.get(`${driver.id}_${m}`) ?? []])
      );
      const leavesByMonth = new Map(
        monthKeysOldestFirst.map((m) => [m, leavesByDriverMonth.get(`${driver.id}_${m}`) ?? []])
      );
      return {
        driverId: driver.id,
        driverName: driver.name,
        balance: computeBancoHorasBalance(driver, monthKeysOldestFirst, entriesByMonth, leavesByMonth),
      };
    })
    .filter(({ balance }) => balance.creditMinutes > 0 || balance.debitMinutes > 0);
}
