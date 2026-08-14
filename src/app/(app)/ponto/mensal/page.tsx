import Link from "next/link";
import { addMonths, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { cardClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { buildMonthlyReport } from "@/lib/pontoMensal";
import { formatHoursMinutes } from "@/lib/time";
import { buildSortHref, nextSortDir } from "@/lib/sort";
import DriverMonthRow, { type WeekStripView } from "./DriverMonthRow";
import ExportBar from "./ExportBar";

const TOTAL_SORT_KEY = "total";
const MOTORISTA_SORT_KEY = "motorista";
const semanaSortKey = (i: number) => `semana-${i}`;

export default async function PontoMensalPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; sort?: string; dir?: string }>;
}) {
  const session = await requireSession();
  const { mes, sort, dir } = await searchParams;

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);
  const prevMonth = format(subMonths(monthStart, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthStart, 1), "yyyy-MM");
  const mesAtual = format(monthStart, "yyyy-MM");

  const report = await buildMonthlyReport(session.companyId, monthStart);

  const rows = report.map((r) => ({
    driverId: r.driverId,
    driverName: r.driverName,
    totalMinutes: r.totalMinutes,
    totalLabel: formatHoursMinutes(r.totalMinutes),
    weekMinutes: r.weeks.map((w) => w.subtotalMinutes),
    weekTotals: r.weeks.map((w) => formatHoursMinutes(w.subtotalMinutes)),
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

  const weekCount = report[0]?.weeks.length ?? 0;
  // Rotulo curto pro cabecalho da coluna ("03/08–09/08"), sem o sufixo
  // "(semana parcial)" — o rotulo completo continua no titulo (tooltip) e
  // dentro do drill on/off.
  const weekHeaderLabels = (report[0]?.weeks ?? []).map((w) => ({
    short: w.label.replace(" (semana parcial)", ""),
    full: w.label,
  }));

  const sortDir = dir === "asc" ? "asc" : "desc";
  const sortableKeys = new Set([MOTORISTA_SORT_KEY, TOTAL_SORT_KEY, ...weekHeaderLabels.map((_, i) => semanaSortKey(i))]);
  const sortedRows =
    sort && sortableKeys.has(sort)
      ? [...rows].sort((a, b) => {
          let cmp: number;
          if (sort === MOTORISTA_SORT_KEY) cmp = a.driverName.localeCompare(b.driverName);
          else if (sort === TOTAL_SORT_KEY) cmp = a.totalMinutes - b.totalMinutes;
          else {
            const idx = Number(sort.slice("semana-".length));
            cmp = (a.weekMinutes[idx] ?? 0) - (b.weekMinutes[idx] ?? 0);
          }
          return sortDir === "desc" ? -cmp : cmp;
        })
      : rows; // padrao: ja vem alfabetico do orderBy do Prisma

  const sortLinkParams = { mes: mesAtual };
  const gridTemplateColumns = `1fr ${"92px ".repeat(weekCount)}110px 28px`;

  const headerCell = (label: string, field: string, title?: string, align: "left" | "right" = "right") => {
    const active = sort === field;
    const linkDir = nextSortDir(sort, sortDir, field);
    const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <Link
        href={buildSortHref("/ponto/mensal", sortLinkParams, field, linkDir)}
        title={title}
        className={`inline-flex items-center gap-1 hover:text-slate-700 ${
          align === "right" ? "justify-end" : ""
        } ${active ? "text-slate-800" : ""}`}
      >
        {label}
        <Icon className="h-3 w-3" />
      </Link>
    );
  };

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
        <div className="overflow-x-auto">
          <div
            style={{ gridTemplateColumns }}
            className="grid gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            <div className="flex items-center">{headerCell("Motorista", MOTORISTA_SORT_KEY, undefined, "left")}</div>
            {weekHeaderLabels.map((w, i) => (
              <div key={i}>{headerCell(w.short, semanaSortKey(i), w.full)}</div>
            ))}
            <div>{headerCell("Total do mês", TOTAL_SORT_KEY)}</div>
            <div />
          </div>
          {sortedRows.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Nenhum motorista ativo cadastrado.</p>
          )}
          {sortedRows.map((r) => (
            <DriverMonthRow
              key={r.driverId}
              driverName={r.driverName}
              totalLabel={r.totalLabel}
              weekTotals={r.weekTotals}
              gridTemplateColumns={gridTemplateColumns}
              weeks={r.weeks}
            />
          ))}
        </div>
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
