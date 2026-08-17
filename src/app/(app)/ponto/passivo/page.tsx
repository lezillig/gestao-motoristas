import Link from "next/link";
import { addMonths, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, ChevronLeft, ChevronRight, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { cardClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { buildPassivoReport, PASSIVO_TIPO_LABELS, type PassivoTipo } from "@/lib/passivoTrabalhista";
import PassivoDriverTable, { type PassivoDriverRow } from "./PassivoDriverTable";

const currency = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const TIPO_ICON_TONE: Record<PassivoTipo, string> = {
  sumula291: "bg-red-100 text-red-700",
  intervalo: "bg-amber-100 text-amber-700",
  interjornada: "bg-indigo-100 text-indigo-700",
  dsr: "bg-blue-100 text-blue-700",
};

export default async function PassivoTrabalhistaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR", "FOLHA");
  const { mes } = await searchParams;

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const anchorMonthStart = startOfMonth(anchor);
  const windowEndExclusive = addMonths(anchorMonthStart, 1);
  const prevMonth = format(subMonths(anchorMonthStart, 1), "yyyy-MM");
  const nextMonth = format(addMonths(anchorMonthStart, 1), "yyyy-MM");

  const report = await buildPassivoReport(session.companyId, windowEndExclusive);

  const firstMonthCents = report.trend[0]?.totalCents ?? 0;
  const lastMonthCents = report.trend[report.trend.length - 1]?.totalCents ?? 0;
  const trendUp = lastMonthCents > firstMonthCents;
  const trendDeltaPercent =
    firstMonthCents > 0 ? Math.round(((lastMonthCents - firstMonthCents) / firstMonthCents) * 100) : null;

  const maxMonthCents = Math.max(1, ...report.trend.map((t) => t.totalCents));

  const byOvertimeDesc = report.drivers;
  const redCount = Math.ceil(byOvertimeDesc.length * 0.2);
  const amberCount = Math.ceil(byOvertimeDesc.length * 0.4);
  const tierByDriverId = new Map<string, "alto" | "medio" | "normal">(
    byOvertimeDesc.map((r, i) => [r.driverId, i < redCount ? "alto" : i < redCount + amberCount ? "medio" : "normal"])
  );

  const gridTemplateColumns = `1fr ${"110px ".repeat(report.monthKeys.length)}130px`;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Passivo trabalhista estimado"
        subtitle="Exposição financeira acumulada por motorista, projetada a partir das violações já detectadas — para acompanhar tendência e priorizar decisão, não para cálculo pericial."
      />

      <div className="mb-6 flex items-center gap-3">
        <Link
          href={`/ponto/passivo?mes=${prevMonth}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" /> Mês anterior
        </Link>
        <p className="text-sm font-medium text-slate-700">
          Janela de {report.monthKeys.length} meses até {format(anchorMonthStart, "MMMM/yyyy", { locale: ptBR })}
        </p>
        <Link
          href={`/ponto/passivo?mes=${nextMonth}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Próximo mês <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-slate-100">
            <Scale className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Passivo acumulado</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{currency(report.totalCents)}</p>
          <p className="text-xs text-slate-500">na janela de {report.monthKeys.length} meses</p>
        </div>

        <div className={cardClass}>
          <div
            className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
              trendUp ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {trendUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          </div>
          <p className="text-sm text-slate-500">Tendência</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">
            {trendDeltaPercent === null ? "—" : `${trendDeltaPercent > 0 ? "+" : ""}${trendDeltaPercent}%`}
          </p>
          <p className="text-xs text-slate-500">
            {report.trend[0]?.label} ({currency(firstMonthCents)}) → {report.trend[report.trend.length - 1]?.label} (
            {currency(lastMonthCents)})
          </p>
        </div>

        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Motoristas com passivo</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{report.drivers.length}</p>
          <p className="text-xs text-slate-500">
            {report.driversWithoutValorHora > 0
              ? `${report.driversWithoutValorHora} sem valor-hora cadastrado, fora da soma`
              : "todos com valor-hora configurado"}
          </p>
        </div>
      </div>

      <div className={`${cardClass} mb-6`}>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Evolução mensal por tipo</h2>
        <div className="flex items-end gap-3" style={{ height: 160 }}>
          {report.trend.map((point) => (
            <div key={point.monthKey} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="text-xs font-medium text-slate-600">
                {point.totalCents > 0 ? currency(point.totalCents) : "—"}
              </span>
              <div className="flex w-full flex-1 items-end overflow-hidden rounded-md bg-slate-50">
                <div
                  className="w-full bg-slate-800"
                  style={{ height: `${Math.max(2, (point.totalCents / maxMonthCents) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-slate-500">{point.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
          {(Object.keys(PASSIVO_TIPO_LABELS) as PassivoTipo[]).map((tipo) => (
            <div key={tipo} className="flex items-start gap-2">
              <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${TIPO_ICON_TONE[tipo].split(" ")[0]}`} />
              <div>
                <p className="text-sm font-semibold text-slate-900">{currency(report.byTypeCents[tipo])}</p>
                <p className="text-xs leading-tight text-slate-500">{PASSIVO_TIPO_LABELS[tipo]}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${cardClass} overflow-hidden p-0`}>
        <div className="overflow-x-auto">
          <div
            style={{ gridTemplateColumns }}
            className="grid gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            <div>Motorista</div>
            {report.trend.map((point) => (
              <div key={point.monthKey} className="text-right">
                {point.label}
              </div>
            ))}
            <div className="text-right">Total</div>
          </div>
          <PassivoDriverTable
            gridTemplateColumns={gridTemplateColumns}
            rows={report.drivers.map(
              (d): PassivoDriverRow => ({
                driverId: d.driverId,
                driverName: d.driverName,
                monthlyLabels: d.monthlyCents.map((c) => (c > 0 ? currency(c) : "—")),
                totalLabel: currency(d.totalCents),
                tier: tierByDriverId.get(d.driverId) ?? "normal",
              })
            )}
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Estimativa de exposição financeira — não é cálculo pericial nem aconselhamento jurídico, e não considera
        correção monetária. Só entram motoristas com valor-hora cadastrado. Fórmulas: Súmula 291 usa a média de hora
        extra dos 3 meses anteriores × valor da hora extra (só calculável a partir do 4º mês da janela); DSR usa 1
        dia de salário (Súmula 146, TST); intervalo e interjornada usam os minutos presumidos/faltantes × valor-hora
        × 50% (natureza indenizatória). Nome em <span className="text-red-600">vermelho</span> = 20% com maior
        passivo; em <span className="text-amber-600">âmbar</span> = próximos 40%.
      </p>
    </div>
  );
}
