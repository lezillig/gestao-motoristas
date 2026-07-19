import Link from "next/link";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";

export default async function EscalasPage({
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

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Escalas"
        subtitle="Vínculo motorista × veículo por turno."
        actionHref="/escalas/novo"
        actionLabel="Nova escala"
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
                    return (
                      <td key={key} className="px-2 py-2 align-top">
                        <div className="flex flex-col gap-1">
                          {items.map((e) => (
                            <Link
                              key={e.id}
                              href={`/escalas/${e.id}`}
                              className="block rounded-md bg-blue-50 px-2 py-1 text-center text-xs font-medium text-blue-800 hover:bg-blue-100"
                            >
                              {e.startTime}–{e.endTime}
                              <span className="block font-mono text-[10px] text-blue-600">
                                {e.vehicle.plate}
                              </span>
                            </Link>
                          ))}
                          {items.length === 0 && (
                            <Link
                              href={`/escalas/novo?date=${format(d, "yyyy-MM-dd")}&driverId=${driver.id}`}
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
