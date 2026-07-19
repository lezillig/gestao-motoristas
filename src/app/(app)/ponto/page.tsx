import Link from "next/link";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import {
  findInterjornadaViolations,
  overtimeMinutes,
  workedMinutes,
} from "@/lib/pontoCompliance";
import { driverDailyLimitMinutes } from "@/lib/convencao";
import { formatHoursMinutes } from "@/lib/time";

export default async function PontoPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string }>;
}) {
  const session = await requireSession();
  const { semana } = await searchParams;

  const anchor = semana ? new Date(`${semana}T00:00:00`) : new Date();
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = addDays(weekStart, 7);

  const prevWeek = format(subWeeks(weekStart, 1), "yyyy-MM-dd");
  const nextWeek = format(addWeeks(weekStart, 1), "yyyy-MM-dd");

  const [drivers, entriesInWeek, entriesForInterjornada] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { name: "asc" },
      include: { sindicato: { include: { convencoes: { include: { regras: true } } } } },
    }),
    prisma.timeClockEntry.findMany({
      where: { companyId: session.companyId, date: { gte: weekStart, lt: weekEnd } },
    }),
    // Inclui o dia anterior ao inicio da semana para conseguir detectar uma
    // violacao de interjornada que comeca no ultimo turno da semana passada.
    prisma.timeClockEntry.findMany({
      where: { companyId: session.companyId, date: { gte: addDays(weekStart, -1), lt: weekEnd } },
    }),
  ]);

  const violations = findInterjornadaViolations(entriesForInterjornada);
  const violationsInWeek = violations.filter((v) =>
    entriesInWeek.some((e) => e.id === v.nextEntryId)
  );
  const violatedEntryIds = new Set(violationsInWeek.map((v) => v.nextEntryId));

  const dailyLimitByDriver = new Map(drivers.map((d) => [d.id, driverDailyLimitMinutes(d)]));
  const dailyLimitFor = (driverId: string) =>
    dailyLimitByDriver.get(driverId)?.minutes ?? undefined;

  const overtimeCount = entriesInWeek.filter(
    (e) => overtimeMinutes(workedMinutes(e), dailyLimitFor(e.driverId)) > 0
  ).length;
  const openShiftsCount = entriesInWeek.filter((e) => !e.clockOut).length;

  const cell = new Map<string, typeof entriesInWeek>();
  for (const e of entriesInWeek) {
    const key = `${e.driverId}_${format(e.date, "yyyy-MM-dd")}`;
    const list = cell.get(key) ?? [];
    list.push(e);
    cell.set(key, list);
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Ponto"
        subtitle="Registro de jornada e checagem automática de hora extra e interjornada (Lei 13.103/2015)."
        actionHref="/ponto/novo"
        actionLabel="Novo registro"
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{overtimeCount}</p>
          <p className="mt-0.5 text-xs text-slate-500">Turnos com hora extra nesta semana</p>
        </div>
        <div className={cardClass}>
          <div
            className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
              violationsInWeek.length > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{violationsInWeek.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Violações de interjornada (descanso &lt; 11h)</p>
        </div>
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Clock className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{openShiftsCount}</p>
          <p className="mt-0.5 text-xs text-slate-500">Turnos ainda em aberto</p>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <Link
          href={`/ponto?semana=${prevWeek}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" /> Semana anterior
        </Link>
        <p className="text-sm font-medium text-slate-700">
          {format(weekStart, "dd/MM")} – {format(addDays(weekStart, 6), "dd/MM/yyyy")}
        </p>
        <Link
          href={`/ponto?semana=${nextWeek}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Próxima semana <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 bg-slate-50 px-4 py-3">Motorista</th>
                {days.map((d) => (
                  <th key={d.toISOString()} className="px-3 py-3 text-center">
                    {format(d, "EEE", { locale: ptBR })}
                    <span className="block font-normal normal-case text-slate-400">
                      {format(d, "dd/MM")}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    Nenhum motorista ativo cadastrado.
                  </td>
                </tr>
              )}
              {drivers.map((driver) => (
                <tr key={driver.id} className="border-b border-slate-100 last:border-0">
                  <td className="sticky left-0 bg-white px-4 py-2.5 font-medium text-slate-800">
                    {driver.name}
                  </td>
                  {days.map((d) => {
                    const key = `${driver.id}_${format(d, "yyyy-MM-dd")}`;
                    const items = cell.get(key) ?? [];
                    const limit = dailyLimitByDriver.get(driver.id);
                    return (
                      <td key={key} className="px-2 py-2 align-top">
                        <div className="flex flex-col gap-1">
                          {items.map((e) => {
                            const worked = workedMinutes(e);
                            const overtime = overtimeMinutes(worked, limit?.minutes);
                            const violated = violatedEntryIds.has(e.id);
                            const tone = !e.clockOut
                              ? "bg-slate-100 text-slate-500 border border-dashed border-slate-300"
                              : overtime > 0
                                ? "bg-amber-50 text-amber-800"
                                : "bg-blue-50 text-blue-800";
                            return (
                              <Link
                                key={e.id}
                                href={`/ponto/${e.id}`}
                                className={`block rounded-md px-2 py-1 text-center text-xs font-medium hover:opacity-80 ${tone} ${
                                  violated ? "ring-2 ring-red-400" : ""
                                }`}
                              >
                                {e.clockIn}–{e.clockOut ?? "?"}
                                <span className="block text-[10px]">
                                  {worked !== null ? formatHoursMinutes(worked) : "em aberto"}
                                </span>
                                {overtime > 0 && limit?.source && (
                                  <span className="block text-[9px] italic text-amber-600">
                                    CCT {limit.source}
                                  </span>
                                )}
                              </Link>
                            );
                          })}
                          {items.length === 0 && (
                            <Link
                              href={`/ponto/novo?date=${format(d, "yyyy-MM-dd")}&driverId=${driver.id}`}
                              className="flex h-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-50 hover:text-blue-600"
                              aria-label="Adicionar registro de ponto"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Link>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {violationsInWeek.length > 0 && (
        <p className={`${badgeClass} mt-3 bg-red-100 text-red-700`}>
          Borda vermelha = descanso entre turnos abaixo de 11h (interjornada, Lei 13.103/2015)
        </p>
      )}
    </div>
  );
}
