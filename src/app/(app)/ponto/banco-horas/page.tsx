import { format, startOfMonth, subMonths, addMonths } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { formatHoursMinutes } from "@/lib/time";
import { BANCO_HORAS_WINDOW_MONTHS, computeBancoHorasBalance } from "@/lib/bancoHoras";
import type { TimeClockEntry, DriverLeave } from "@prisma/client";

export default async function BancoHorasPage() {
  const session = await requireSession();

  const today = new Date();
  const windowStart = startOfMonth(subMonths(today, BANCO_HORAS_WINDOW_MONTHS - 1));
  const windowEndExclusive = startOfMonth(addMonths(today, 1));

  const monthKeysOldestFirst: string[] = [];
  for (let i = BANCO_HORAS_WINDOW_MONTHS - 1; i >= 0; i--) {
    monthKeysOldestFirst.push(format(subMonths(today, i), "yyyy-MM"));
  }

  const [drivers, entries, leaves] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { name: "asc" },
      include: { sindicato: { include: { convencoes: { include: { regras: true } } } } },
    }),
    prisma.timeClockEntry.findMany({
      where: { companyId: session.companyId, date: { gte: windowStart, lt: windowEndExclusive } },
    }),
    prisma.driverLeave.findMany({
      where: { companyId: session.companyId, startDate: { gte: windowStart, lt: windowEndExclusive } },
    }),
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

  const balances = drivers
    .map((driver) => {
      const entriesByMonth = new Map(
        monthKeysOldestFirst.map((m) => [m, entriesByDriverMonth.get(`${driver.id}_${m}`) ?? []])
      );
      const leavesByMonth = new Map(
        monthKeysOldestFirst.map((m) => [m, leavesByDriverMonth.get(`${driver.id}_${m}`) ?? []])
      );
      return {
        driver,
        balance: computeBancoHorasBalance(driver, monthKeysOldestFirst, entriesByMonth, leavesByMonth),
      };
    })
    .filter(({ balance }) => balance.creditMinutes > 0 || balance.debitMinutes > 0)
    .sort((a, b) => b.balance.balanceMinutes - a.balance.balanceMinutes);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Banco de horas"
        subtitle={`Saldo estimado de hora extra (crédito) menos folgas compensadas (débito) nos últimos ${BANCO_HORAS_WINDOW_MONTHS} meses.`}
      />

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3 text-right">Crédito (hora extra)</th>
                <th className="px-4 py-3 text-right">Débito (folgas)</th>
                <th className="px-4 py-3 text-right">Saldo</th>
                <th className="px-4 py-3">Alerta</th>
              </tr>
            </thead>
            <tbody>
              {balances.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Nenhum saldo de banco de horas no período.
                  </td>
                </tr>
              )}
              {balances.map(({ driver, balance }) => (
                <tr key={driver.id} className="border-b border-slate-100 last:border-0">
                  <td className={`px-4 py-3 font-medium ${balance.atRisk ? "text-red-600" : "text-slate-800"}`}>
                    {driver.name}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatHoursMinutes(balance.creditMinutes)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatHoursMinutes(balance.debitMinutes)}</td>
                  <td
                    className={`px-4 py-3 text-right font-medium ${
                      balance.balanceMinutes > 0 ? "text-amber-700" : "text-slate-600"
                    }`}
                  >
                    {formatHoursMinutes(Math.max(0, balance.balanceMinutes))}
                  </td>
                  <td className="px-4 py-3">
                    {balance.atRisk && (
                      <span
                        className={`${badgeClass} inline-flex items-center gap-1 bg-red-100 text-red-700`}
                        title={`Crédito de hora extra desde ${balance.oldestUnconsumedCreditMonth} ainda não compensado — perto do limite de ${BANCO_HORAS_WINDOW_MONTHS} meses (art. 59, §§5º-6º CLT). O excedente pode ter que ser pago em vez de compensado (Súmula 85, IV, TST).`}
                      >
                        <AlertTriangle className="h-3 w-3" /> Perto do limite
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Débito aproximado pelo limite diário de cada motorista por folga tirada (não há registro de quantas horas
        cada folga efetivamente compensou) — é uma estimativa para acompanhamento, não um saldo contábil exato. Não
        é aconselhamento jurídico.
      </p>
    </div>
  );
}
