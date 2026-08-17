import Link from "next/link";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Clock, History, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import KpiCard from "@/components/ui/KpiCard";
import { buildSortHref, nextSortDir } from "@/lib/sort";
import {
  findInterjornadaViolations,
  overtimeMinutes,
  workedMinutes,
} from "@/lib/pontoCompliance";
import { driverDailyLimitMinutes } from "@/lib/convencao";
import { formatHoursMinutes } from "@/lib/time";
import { isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";

export default async function PontoPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string; motorista?: string; sort?: string; dir?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { semana, motorista, sort, dir } = await searchParams;

  const anchor = semana ? new Date(`${semana}T00:00:00`) : new Date();
  const weekStart = startOfWeek(anchor, { weekStartsOn: 0 });
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

  // Turnos com pelo menos uma correcao (reimportacao do TiqueTaque que
  // atualizou um registro ja existente) — so pra decidir o selo "corrigido"
  // no chip; o detalhe do antes/depois fica em /ponto/correcoes.
  const correctedEntryIds = new Set(
    (
      await prisma.timeClockCorrection.findMany({
        where: { companyId: session.companyId, entryId: { in: entriesInWeek.map((e) => e.id) } },
        select: { entryId: true },
      })
    ).map((c) => c.entryId)
  );

  const violations = findInterjornadaViolations(entriesForInterjornada);
  const violationsInWeek = violations.filter((v) =>
    entriesInWeek.some((e) => e.id === v.nextEntryId)
  );
  const violatedEntryIds = new Set(violationsInWeek.map((v) => v.nextEntryId));

  const dailyLimitByDriver = new Map(drivers.map((d) => [d.id, driverDailyLimitMinutes(d)]));
  const dailyLimitFor = (driverId: string) =>
    dailyLimitByDriver.get(driverId)?.minutes ?? undefined;

  const overtimeEntries = entriesInWeek.filter(
    (e) => overtimeMinutes(workedMinutes(e), dailyLimitFor(e.driverId)) > 0
  );
  const overtimeCount = overtimeEntries.length;
  const openShiftEntries = entriesInWeek.filter((e) => !e.clockOut);
  const openShiftsCount = openShiftEntries.length;

  const driverNameById = new Map(drivers.map((d) => [d.id, d.name]));
  const entryById = new Map(entriesInWeek.map((e) => [e.id, e]));

  const overtimeDetailRows = overtimeEntries
    .map((e) => ({
      id: e.id,
      href: `/ponto/${e.id}`,
      cells: [
        driverNameById.get(e.driverId) ?? "—",
        format(e.date, "dd/MM/yyyy"),
        `${e.clockIn}–${e.clockOut ?? "?"}`,
        formatHoursMinutes(overtimeMinutes(workedMinutes(e), dailyLimitFor(e.driverId))),
      ],
    }))
    .sort((a, b) => b.cells[1].localeCompare(a.cells[1]));

  const violationDetailRows = violationsInWeek
    .map((v) => {
      const next = entryById.get(v.nextEntryId);
      return {
        id: v.nextEntryId,
        href: `/ponto/${v.nextEntryId}`,
        cells: [
          driverNameById.get(v.driverId) ?? "—",
          next ? format(next.date, "dd/MM/yyyy") : "—",
          formatHoursMinutes(v.gapMinutes),
        ],
      };
    })
    .sort((a, b) => b.cells[1].localeCompare(a.cells[1]));

  const openShiftDetailRows = openShiftEntries
    .map((e) => ({
      id: e.id,
      href: `/ponto/${e.id}`,
      cells: [driverNameById.get(e.driverId) ?? "—", format(e.date, "dd/MM/yyyy"), e.clockIn],
    }))
    .sort((a, b) => b.cells[1].localeCompare(a.cells[1]));

  const cell = new Map<string, typeof entriesInWeek>();
  for (const e of entriesInWeek) {
    const key = `${e.driverId}_${format(e.date, "yyyy-MM-dd")}`;
    const list = cell.get(key) ?? [];
    list.push(e);
    cell.set(key, list);
  }

  // Total trabalhado por motorista+dia (soma quando ha mais de 1 registro no
  // dia) — usado tanto pra ordenar por um dia especifico quanto, no futuro,
  // qualquer outro agregado por dia.
  const dayKeys = days.map((d) => format(d, "yyyy-MM-dd"));
  const workedByDriverDay = new Map<string, number>();
  for (const driver of drivers) {
    for (const dayKey of dayKeys) {
      const items = cell.get(`${driver.id}_${dayKey}`) ?? [];
      const total = items.reduce((sum, e) => sum + (workedMinutes(e) ?? 0), 0);
      workedByDriverDay.set(`${driver.id}_${dayKey}`, total);
    }
  }

  // Total trabalhado na semana por motorista — soma dos 7 dias acima, usado
  // tanto na coluna "Total" quanto pra ordenar por ela.
  const TOTAL_SORT_KEY = "total";
  const workedByDriverWeek = new Map<string, number>();
  for (const driver of drivers) {
    const total = dayKeys.reduce(
      (sum, dayKey) => sum + (workedByDriverDay.get(`${driver.id}_${dayKey}`) ?? 0),
      0
    );
    workedByDriverWeek.set(driver.id, total);
  }

  const motoristaFiltro = motorista?.trim().toLowerCase();
  const filteredDrivers = motoristaFiltro
    ? drivers.filter((d) => d.name.toLowerCase().includes(motoristaFiltro))
    : drivers;

  const sortableKeys = new Set([...dayKeys, TOTAL_SORT_KEY]);
  const sortDir = dir === "asc" ? "asc" : "desc";
  const sortedDrivers = sort && sortableKeys.has(sort)
    ? [...filteredDrivers].sort((a, b) => {
        const av = sort === TOTAL_SORT_KEY ? workedByDriverWeek.get(a.id) ?? 0 : workedByDriverDay.get(`${a.id}_${sort}`) ?? 0;
        const bv = sort === TOTAL_SORT_KEY ? workedByDriverWeek.get(b.id) ?? 0 : workedByDriverDay.get(`${b.id}_${sort}`) ?? 0;
        return sortDir === "desc" ? bv - av : av - bv;
      })
    : filteredDrivers; // padrao: ja vem alfabetico do orderBy do Prisma

  const sortLinkParams = { semana: format(weekStart, "yyyy-MM-dd"), motorista };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Ponto"
        subtitle="Registro de jornada e checagem automática de hora extra e interjornada (Lei 13.103/2015)."
        actionHref="/ponto/novo"
        actionLabel="Novo registro"
        secondaryActionHref={isTiqueTaqueAvailable() ? "/ponto/importar-tiquetaque" : undefined}
        secondaryActionLabel={isTiqueTaqueAvailable() ? "Importar do TiqueTaque" : undefined}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          iconBgClass="bg-amber-100 text-amber-700"
          value={overtimeCount}
          label="Turnos com hora extra nesta semana"
          columns={["Motorista", "Data", "Horário", "Hora extra"]}
          rows={overtimeDetailRows}
          emptyMessage="Nenhum turno com hora extra nesta semana."
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          iconBgClass={
            violationsInWeek.length > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
          }
          value={violationsInWeek.length}
          label="Violações de interjornada (descanso < 11h)"
          columns={["Motorista", "Data", "Descanso"]}
          rows={violationDetailRows}
          emptyMessage="Nenhuma violação de interjornada nesta semana."
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          iconBgClass="bg-slate-100 text-slate-600"
          value={openShiftsCount}
          label="Turnos ainda em aberto"
          columns={["Motorista", "Data", "Entrada"]}
          rows={openShiftDetailRows}
          emptyMessage="Nenhum turno em aberto nesta semana."
        />
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

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="semana" value={format(weekStart, "yyyy-MM-dd")} />
        {sort && <input type="hidden" name="sort" value={sort} />}
        {dir && <input type="hidden" name="dir" value={dir} />}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Motorista</label>
          <input
            type="text"
            name="motorista"
            defaultValue={motorista ?? ""}
            placeholder="nome"
            className={`${inputClass} w-56`}
          />
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
        {motorista && (
          <Link
            href={`/ponto?semana=${format(weekStart, "yyyy-MM-dd")}${sort ? `&sort=${sort}&dir=${sortDir}` : ""}`}
            className="text-sm text-slate-500 hover:underline"
          >
            Limpar filtro
          </Link>
        )}
      </form>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 bg-slate-50 px-4 py-3">Motorista</th>
                {days.map((d) => {
                  const dayKey = format(d, "yyyy-MM-dd");
                  const active = sort === dayKey;
                  const linkDir = nextSortDir(sort, sortDir, dayKey);
                  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                    <th key={d.toISOString()} className="px-3 py-3 text-center">
                      <Link
                        href={buildSortHref("/ponto", sortLinkParams, dayKey, linkDir)}
                        className={`inline-flex flex-col items-center gap-0.5 hover:text-slate-700 ${active ? "text-slate-800" : ""}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {format(d, "EEE", { locale: ptBR })}
                          <Icon className="h-3 w-3" />
                        </span>
                        <span className="block font-normal normal-case text-slate-400">
                          {format(d, "dd/MM")}
                        </span>
                      </Link>
                    </th>
                  );
                })}
                {(() => {
                  const active = sort === TOTAL_SORT_KEY;
                  const linkDir = nextSortDir(sort, sortDir, TOTAL_SORT_KEY);
                  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                    <th className="border-l border-slate-200 bg-slate-100 px-3 py-3 text-center">
                      <Link
                        href={buildSortHref("/ponto", sortLinkParams, TOTAL_SORT_KEY, linkDir)}
                        className={`inline-flex items-center gap-1 hover:text-slate-700 ${active ? "text-slate-800" : ""}`}
                      >
                        Total
                        <Icon className="h-3 w-3" />
                      </Link>
                    </th>
                  );
                })()}
              </tr>
            </thead>
            <tbody>
              {sortedDrivers.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    {drivers.length === 0 ? "Nenhum motorista ativo cadastrado." : "Nenhum motorista encontrado."}
                  </td>
                </tr>
              )}
              {sortedDrivers.map((driver) => (
                <tr key={driver.id} className="border-b border-slate-100 last:border-0">
                  <td className="sticky left-0 bg-white px-4 py-2.5 text-xs font-medium text-slate-800">
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
                                prefetch={false}
                                className={`block rounded-md px-1.5 py-1 text-center text-xs font-medium hover:opacity-80 ${tone} ${
                                  violated ? "ring-2 ring-red-400" : ""
                                }`}
                              >
                                <span className="block whitespace-nowrap text-[10px]">
                                  {e.clockIn}–{e.clockOut ?? "?"}
                                </span>
                                <span className="block text-[10px]">
                                  {worked !== null ? formatHoursMinutes(worked) : "em aberto"}
                                  {worked !== null && overtime > 0 && ` / ${formatHoursMinutes(overtime)}`}
                                </span>
                                {overtime > 0 && limit?.source && (
                                  <span className="block text-[9px] italic text-amber-600">
                                    CCT {limit.source}
                                  </span>
                                )}
                                {e.fonte === "TIQUETAQUE" && (
                                  <span className="block text-[9px] italic text-slate-500">TiqueTaque</span>
                                )}
                                {correctedEntryIds.has(e.id) && (
                                  <span
                                    className="mt-0.5 flex items-center justify-center gap-0.5 text-[9px] font-medium text-amber-700"
                                    title="Atualizado numa reimportação do TiqueTaque — ver histórico de correções"
                                  >
                                    <History className="h-2.5 w-2.5" /> corrigido
                                  </span>
                                )}
                              </Link>
                            );
                          })}
                          {items.length === 0 && (
                            <Link
                              href={`/ponto/novo?date=${format(d, "yyyy-MM-dd")}&driverId=${driver.id}`}
                              prefetch={false}
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
                  <td className="border-l border-slate-100 bg-slate-50/60 px-3 py-2.5 text-center font-medium text-slate-800">
                    {formatHoursMinutes(workedByDriverWeek.get(driver.id) ?? 0)}
                  </td>
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
