import { prisma } from "@/lib/prisma";
import { workedMinutes, overtimeMinutes, REGIME_12X36_WORK_MINUTES } from "@/lib/pontoCompliance";
import { driverDailyLimitMinutes, driverRegime12x36 } from "@/lib/convencao";

export type DriverAnnualReport = {
  driverId: string;
  driverName: string;
  // 12 posicoes, Janeiro (indice 0) a Dezembro (indice 11).
  monthlyOvertimeMinutes: number[];
  totalOvertimeMinutes: number;
};

// Hora extra por mes (nao total trabalhado) — o objetivo explicito deste
// relatorio e identificar motoristas com hora extra recorrente ao longo do
// ano, entao o numero relevante e sempre o excedente sobre o limite diario
// de cada um (CCT/ACT/regime individual, mesma resolucao ja usada em
// /ponto/mensal e /ponto/analise), nunca o total de horas trabalhadas.
export async function buildAnnualReport(companyId: string, year: number): Promise<DriverAnnualReport[]> {
  const yearStart = new Date(year, 0, 1);
  const yearEndExclusive = new Date(year + 1, 0, 1);

  const [drivers, entries] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId, active: true },
      orderBy: { name: "asc" },
      include: { sindicato: { include: { convencoes: { include: { regras: true } } } } },
    }),
    prisma.timeClockEntry.findMany({ where: { companyId, date: { gte: yearStart, lt: yearEndExclusive } } }),
  ]);

  const dailyLimitByDriver = new Map(drivers.map((d) => [d.id, driverDailyLimitMinutes(d)]));
  const regime12x36ByDriver = new Map(drivers.map((d) => [d.id, driverRegime12x36(d)]));

  const monthlyByDriver = new Map<string, number[]>();
  for (const entry of entries) {
    const regime = regime12x36ByDriver.get(entry.driverId);
    const limit = dailyLimitByDriver.get(entry.driverId);
    const effectiveLimit = regime?.ativo ? REGIME_12X36_WORK_MINUTES : limit?.minutes;
    const overtime = overtimeMinutes(workedMinutes(entry), effectiveLimit);
    if (overtime <= 0) continue;
    const arr = monthlyByDriver.get(entry.driverId) ?? new Array(12).fill(0);
    arr[entry.date.getMonth()] += overtime;
    monthlyByDriver.set(entry.driverId, arr);
  }

  return drivers
    .map((driver) => {
      const monthlyOvertimeMinutes = monthlyByDriver.get(driver.id) ?? new Array(12).fill(0);
      const totalOvertimeMinutes = monthlyOvertimeMinutes.reduce((sum, m) => sum + m, 0);
      return { driverId: driver.id, driverName: driver.name, monthlyOvertimeMinutes, totalOvertimeMinutes };
    })
    .filter((r) => r.totalOvertimeMinutes > 0);
}
