import Link from "next/link";
import { addMonths, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { cardClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { buildMonthlyReport } from "@/lib/pontoMensal";
import { formatHoursMinutes } from "@/lib/time";
import DriverMonthRow, { type WeekStripView } from "./DriverMonthRow";
import ExportBar from "./ExportBar";

export default async function PontoMensalPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const session = await requireSession();
  const { mes } = await searchParams;

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);
  const prevMonth = format(subMonths(monthStart, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthStart, 1), "yyyy-MM");
  const mesAtual = format(monthStart, "yyyy-MM");

  const report = await buildMonthlyReport(session.companyId, monthStart);

  const rows = report.map((r) => ({
    driverId: r.driverId,
    driverName: r.driverName,
    totalLabel: formatHoursMinutes(r.totalMinutes),
    weeks: r.weeks.map(
      (w): WeekStripView => ({
        label: w.label,
        subtotal: formatHoursMinutes(w.subtotalMinutes),
        days: w.days.map((d) =>
          d
            ? {
                label: format(d.date, "EEE dd/MM", { locale: ptBR }),
                value: d.open ? "em aberto" : d.hasEntry ? formatHoursMinutes(d.minutes) : "—",
                hasEntry: d.hasEntry,
                overtime: d.overtime,
                interjornadaViolation: d.interjornadaViolation,
                missingInterval: d.missingInterval,
              }
            : null
        ),
      })
    ),
  }));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Relatório mensal"
        subtitle="Total de horas trabalhadas por motorista no mês, com detalhamento diário e exportação."
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/ponto/mensal?mes=${prevMonth}`}
            className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" /> Mês anterior
          </Link>
          <p className="text-sm font-medium text-slate-700">{format(monthStart, "MMMM/yyyy", { locale: ptBR })}</p>
          <Link
            href={`/ponto/mensal?mes=${nextMonth}`}
            className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Próximo mês <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <ExportBar mes={mesAtual} />
      </div>

      <div className={`${cardClass} overflow-hidden p-0`}>
        <div className="grid grid-cols-[1fr_120px_28px] gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <div>Motorista</div>
          <div className="text-right">Total do mês</div>
          <div />
        </div>
        {rows.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Nenhum motorista ativo cadastrado.</p>
        )}
        {rows.map((r) => (
          <DriverMonthRow key={r.driverId} driverName={r.driverName} totalLabel={r.totalLabel} weeks={r.weeks} />
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Clique num motorista pra ver o detalhamento diário. Âmbar = hora extra. Borda vermelha = descanso
        insuficiente entre turnos ou intervalo intrajornada não registrado (ver{" "}
        <Link href="/ponto/analise" className="text-blue-600 hover:underline">
          Análise de riscos
        </Link>{" "}
        para o detalhe de cada ocorrência).
      </p>
    </div>
  );
}
