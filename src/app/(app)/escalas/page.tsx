import Link from "next/link";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { buildSortHref, nextSortDir } from "@/lib/sort";
import { toMinutes } from "@/lib/time";

export default async function EscalasPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string; motorista?: string; todos?: string; sort?: string; dir?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { semana, motorista, todos, sort, dir } = await searchParams;

  const anchor = semana ? new Date(`${semana}T00:00:00`) : new Date();
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = addDays(weekStart, 7);

  const prevWeek = format(subWeeks(weekStart, 1), "yyyy-MM-dd");
  const nextWeek = format(addWeeks(weekStart, 1), "yyyy-MM-dd");

  const [drivers, escalas] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.escala.findMany({
      where: { companyId: session.companyId, date: { gte: weekStart, lt: weekEnd } },
      include: { vehicle: true },
    }),
  ]);

  const cell = new Map<string, typeof escalas>();
  for (const e of escalas) {
    const key = `${e.driverId}_${format(e.date, "yyyy-MM-dd")}`;
    const list = cell.get(key) ?? [];
    list.push(e);
    cell.set(key, list);
  }

  // Horario mais cedo da semana, por motorista — usado pro sort por horario
  // e pra decidir quem "tem escala nesta semana".
  const earliestStartByDriver = new Map<string, number>();
  for (const e of escalas) {
    const current = earliestStartByDriver.get(e.driverId);
    const minutes = toMinutes(e.startTime);
    if (current === undefined || minutes < current) earliestStartByDriver.set(e.driverId, minutes);
  }

  const motoristaFiltro = motorista?.trim().toLowerCase();
  const mostrarTodos = todos === "1";
  const filteredDrivers = drivers.filter((d) => {
    if (motoristaFiltro && !d.name.toLowerCase().includes(motoristaFiltro)) return false;
    if (!mostrarTodos && !earliestStartByDriver.has(d.id)) return false;
    return true;
  });

  const sortDir = dir === "asc" ? "asc" : "desc";
  const sortedDrivers =
    sort === "horario"
      ? [...filteredDrivers].sort((a, b) => {
          const av = earliestStartByDriver.get(a.id) ?? Infinity;
          const bv = earliestStartByDriver.get(b.id) ?? Infinity;
          return sortDir === "asc" ? av - bv : bv - av;
        })
      : sort === "nome" && sortDir === "desc"
        ? [...filteredDrivers].sort((a, b) => b.name.localeCompare(a.name))
        : filteredDrivers; // padrao: ja vem alfabetico do orderBy do Prisma

  const sortLinkParams = { semana: format(weekStart, "yyyy-MM-dd"), motorista, todos: mostrarTodos ? "1" : undefined };
  const baseHref = `/escalas?semana=${format(weekStart, "yyyy-MM-dd")}${motorista ? `&motorista=${encodeURIComponent(motorista)}` : ""}${sort ? `&sort=${sort}&dir=${sortDir}` : ""}`;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Escalas"
        subtitle="Vínculo motorista × veículo por turno."
        actionHref="/escalas/novo"
        actionLabel="Nova escala"
        secondaryActionHref="/escalas/importar-siat"
        secondaryActionLabel="Sincronizar com SIAT"
      />

      <div className="mb-4 flex items-center justify-between">
        <Link
          href={`/escalas?semana=${prevWeek}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" /> Semana anterior
        </Link>
        <p className="text-sm font-medium text-slate-700">
          {format(weekStart, "dd/MM")} – {format(addDays(weekStart, 6), "dd/MM/yyyy")}
        </p>
        <Link
          href={`/escalas?semana=${nextWeek}`}
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
        <label className="mb-2 flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" name="todos" value="1" defaultChecked={mostrarTodos} className="h-4 w-4 rounded border-slate-300" />
          Mostrar todos (mesmo sem escala nesta semana)
        </label>
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
        {(motorista || mostrarTodos) && (
          <Link
            href={`/escalas?semana=${format(weekStart, "yyyy-MM-dd")}${sort ? `&sort=${sort}&dir=${sortDir}` : ""}`}
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
                <th className="sticky left-0 bg-slate-50 px-4 py-3">
                  <span className="inline-flex items-center gap-3">
                    {(() => {
                      const active = sort === "nome" || !sort;
                      const linkDir = nextSortDir(sort ?? "nome", sortDir, "nome");
                      const Icon = active && sort ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                      return (
                        <Link href={buildSortHref("/escalas", sortLinkParams, "nome", linkDir)} className={`inline-flex items-center gap-1 hover:text-slate-700 ${active ? "text-slate-800" : ""}`}>
                          Motorista <Icon className="h-3 w-3" />
                        </Link>
                      );
                    })()}
                    {(() => {
                      const active = sort === "horario";
                      const linkDir = nextSortDir(sort, sortDir, "horario");
                      const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                      return (
                        <Link href={buildSortHref("/escalas", sortLinkParams, "horario", linkDir)} className={`inline-flex items-center gap-1 normal-case font-normal hover:text-slate-700 ${active ? "text-slate-800" : ""}`}>
                          horário <Icon className="h-3 w-3" />
                        </Link>
                      );
                    })()}
                  </span>
                </th>
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
              {sortedDrivers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {drivers.length === 0
                      ? "Nenhum motorista ativo cadastrado."
                      : mostrarTodos
                        ? "Nenhum motorista encontrado."
                        : "Nenhum motorista com escala nesta semana — marque \"Mostrar todos\" pra ver o cadastro completo."}
                  </td>
                </tr>
              )}
              {sortedDrivers.map((driver) => (
                <tr key={driver.id} className="border-b border-slate-100 last:border-0">
                  <td className="sticky left-0 bg-white px-4 py-2.5 font-medium text-slate-800">
                    {driver.name}
                  </td>
                  {days.map((d) => {
                    const key = `${driver.id}_${format(d, "yyyy-MM-dd")}`;
                    const items = cell.get(key) ?? [];
                    return (
                      <td key={key} className="px-2 py-2 align-top">
                        <div className="flex flex-col gap-1">
                          {items.map((e) => (
                            <Link
                              key={e.id}
                              href={`/escalas/${e.id}`}
                              prefetch={false}
                              className="block rounded-md bg-blue-50 px-2 py-1 text-center text-xs font-medium text-blue-800 hover:bg-blue-100"
                            >
                              {e.startTime}
                              {e.endTime && `–${e.endTime}`}
                              <span className="block font-mono text-[10px] text-blue-600">
                                {e.vehicle.plate}
                              </span>
                              {e.clientName && (
                                <span className="block truncate text-[9px] text-blue-500">{e.clientName}</span>
                              )}
                              {e.fonte === "SIAT" && (
                                <span className="block text-[9px] italic text-slate-500">SIAT</span>
                              )}
                            </Link>
                          ))}
                          {items.length === 0 && (
                            <Link
                              href={`/escalas/novo?date=${format(d, "yyyy-MM-dd")}&driverId=${driver.id}`}
                              prefetch={false}
                              className="flex h-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-50 hover:text-blue-600"
                              aria-label="Adicionar escala"
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
    </div>
  );
}
