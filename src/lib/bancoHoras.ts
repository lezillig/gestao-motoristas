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

    if (monthCredit > 0 && oldestUnconsumedCreditMonth === null && runningBalance > 0) {
      oldestUnconsumedCreditMonth = monthKey;
    }
  }

  const balanceMinutes = creditMinutes - debitMinutes;
  const atRisk = balanceMinutes > 0 && oldestUnconsumedCreditMonth === monthKeysOldestFirst[0];

  return { driverId: driver.id, creditMinutes, debitMinutes, balanceMinutes, oldestUnconsumedCreditMonth, atRisk };
}
