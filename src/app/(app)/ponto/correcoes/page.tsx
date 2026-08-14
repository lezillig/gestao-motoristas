import Link from "next/link";
import { addMonths, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { formatHoursMinutes } from "@/lib/time";
import { workedMinutes } from "@/lib/pontoCompliance";

function turno(
  clockIn: string,
  clockOut: string | null,
  intervaloInicio: string | null,
  intervaloFim: string | null,
  punches: unknown
) {
  if (!clockOut) return { range: `${clockIn}–?`, worked: "em aberto" };
  const minutes = workedMinutes({ clockIn, clockOut, intervaloInicio, intervaloFim, punches });
  return { range: `${clockIn}–${clockOut}`, worked: minutes !== null ? formatHoursMinutes(minutes) : "em aberto" };
}

export default async function PontoCorrecoesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const session = await requireSession();
  const { mes } = await searchParams;

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);
  const monthEnd = startOfMonth(addMonths(anchor, 1));
  const prevMonth = format(subMonths(monthStart, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthStart, 1), "yyyy-MM");

  const corrections = await prisma.timeClockCorrection.findMany({
    where: { companyId: session.companyId, corrigidoEm: { gte: monthStart, lt: monthEnd } },
    include: { driver: { select: { name: true } } },
    orderBy: { corrigidoEm: "desc" },
  });

  const affectedDrivers = new Set(corrections.map((c) => c.driverId)).size;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Histórico de correções"
        subtitle="Turnos importados do TiqueTaque que foram atualizados numa reimportação porque a correção foi feita direto no TiqueTaque."
      />

      <div className="mb-6 flex items-center justify-between">
        <Link
          href={`/ponto/correcoes?mes=${prevMonth}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" /> Mês anterior
        </Link>
        <p className="text-sm font-medium text-slate-700">{format(monthStart, "MMMM/yyyy", { locale: ptBR })}</p>
        <Link
          href={`/ponto/correcoes?mes=${nextMonth}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Próximo mês <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <History className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{corrections.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Correções neste mês</p>
        </div>
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <History className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{affectedDrivers}</p>
          <p className="mt-0.5 text-xs text-slate-500">Motoristas afetados</p>
        </div>
      </div>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Motorista</th>
                <th className="px-3 py-3">Data</th>
                <th className="px-3 py-3">Turno anterior</th>
                <th className="px-3 py-3">Turno corrigido</th>
                <th className="px-3 py-3">Corrigido em</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {corrections.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma correção registrada neste mês.
                  </td>
                </tr>
              )}
              {corrections.map((c) => {
                const antes = turno(c.clockInAntes, c.clockOutAntes, c.intervaloInicioAntes, c.intervaloFimAntes, c.punchesAntes);
                const depois = turno(c.clockInDepois, c.clockOutDepois, c.intervaloInicioDepois, c.intervaloFimDepois, c.punchesDepois);
                return (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{c.driver.name}</td>
                    <td className="px-3 py-2.5 text-slate-600">{format(c.date, "dd/MM/yyyy")}</td>
                    <td className="px-3 py-2.5 text-slate-400 line-through decoration-slate-300">
                      {antes.range}
                      <span className="ml-1 no-underline">({antes.worked})</span>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-amber-700">
                      {depois.range} <span className="text-amber-600">({depois.worked})</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{format(c.corrigidoEm, "dd/MM/yyyy HH:mm")}</td>
                    <td className="px-3 py-2.5">
                      <Link href={`/ponto/${c.entryId}`} className="text-blue-600 hover:underline">
                        Ver registro
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
