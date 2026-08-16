import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { cardClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { buildAnnualReport } from "@/lib/pontoAnual";
import { formatHoursMinutes } from "@/lib/time";
import { buildSortHref, nextSortDir } from "@/lib/sort";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const mesSortKey = (i: number) => `mes-${i}`;
const TOTAL_SORT_KEY = "total";
const MOTORISTA_SORT_KEY = "motorista";

const TIER_TEXT_CLASS: Record<"alto" | "medio" | "normal", string> = {
  alto: "text-red-600",
  medio: "text-amber-600",
  normal: "text-slate-800",
};

export default async function PontoAnualPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; sort?: string; dir?: string }>;
}) {
  const session = await requireSession();
  const { ano, sort, dir } = await searchParams;
  const year = ano ? parseInt(ano, 10) : new Date().getFullYear();

  const report = await buildAnnualReport(session.companyId, year);

  const sortDir = dir === "asc" ? "asc" : "desc";
  const sortableKeys = new Set([MOTORISTA_SORT_KEY, TOTAL_SORT_KEY, ...MESES.map((_, i) => mesSortKey(i))]);
  const sortedRows =
    sort && sortableKeys.has(sort)
      ? [...report].sort((a, b) => {
          let cmp: number;
          if (sort === MOTORISTA_SORT_KEY) cmp = a.driverName.localeCompare(b.driverName);
          else if (sort === TOTAL_SORT_KEY) cmp = a.totalOvertimeMinutes - b.totalOvertimeMinutes;
          else {
            const idx = Number(sort.slice("mes-".length));
            cmp = a.monthlyOvertimeMinutes[idx] - b.monthlyOvertimeMinutes[idx];
          }
          return sortDir === "desc" ? -cmp : cmp;
        })
      : // Padrao sem clique: mais hora extra no ano primeiro — e exatamente o
        // que o relatorio existe pra mostrar, os casos mais recorrentes ja no
        // topo sem precisar clicar em nada.
        [...report].sort((a, b) => b.totalOvertimeMinutes - a.totalOvertimeMinutes);

  // Mesmo ranking fixo 20%/40% ja usado em /ponto/mensal, so que sobre o
  // total do ANO em vez do total do mes.
  const byOvertimeDesc = [...report].sort((a, b) => b.totalOvertimeMinutes - a.totalOvertimeMinutes);
  const redCount = Math.ceil(byOvertimeDesc.length * 0.2);
  const amberCount = Math.ceil(byOvertimeDesc.length * 0.4);
  const tierByDriverId = new Map<string, "alto" | "medio" | "normal">(
    byOvertimeDesc.map((r, i) => [r.driverId, i < redCount ? "alto" : i < redCount + amberCount ? "medio" : "normal"])
  );

  const sortLinkParams = { ano: String(year) };
  const gridTemplateColumns = `1fr ${"64px ".repeat(12)}100px`;

  const headerCell = (label: string, field: string, align: "left" | "right" = "right") => {
    const active = sort === field;
    const linkDir = nextSortDir(sort, sortDir, field);
    const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <Link
        href={buildSortHref("/ponto/anual", sortLinkParams, field, linkDir)}
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
    <div className="max-w-7xl">
      <PageHeader
        title="Relatório anual de horas extras"
        subtitle="Hora extra por mês e total do ano, por motorista — para identificar os casos que mais se repetem."
      />

      <div className="mb-6 flex items-center justify-between">
        <Link
          href={`/ponto/anual?ano=${year - 1}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" /> Ano anterior
        </Link>
        <p className="text-sm font-medium text-slate-700">{year}</p>
        <Link
          href={`/ponto/anual?ano=${year + 1}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Próximo ano <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className={`${cardClass} overflow-hidden p-0`}>
        <div className="overflow-x-auto">
          <div
            style={{ gridTemplateColumns }}
            className="grid gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            <div className="flex items-center">{headerCell("Motorista", MOTORISTA_SORT_KEY, "left")}</div>
            {MESES.map((m, i) => (
              <div key={i}>{headerCell(m, mesSortKey(i))}</div>
            ))}
            <div>{headerCell("Total do ano", TOTAL_SORT_KEY)}</div>
          </div>
          {sortedRows.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Nenhum motorista com hora extra neste ano.</p>
          )}
          {sortedRows.map((r) => {
            const tier = tierByDriverId.get(r.driverId) ?? "normal";
            const tierClass = TIER_TEXT_CLASS[tier];
            return (
              <div
                key={r.driverId}
                style={{ gridTemplateColumns }}
                className="grid items-center gap-2 border-b border-slate-100 px-4 py-3 last:border-0"
              >
                <span className={`text-sm font-medium ${tierClass}`}>{r.driverName}</span>
                {r.monthlyOvertimeMinutes.map((m, i) => (
                  <span key={i} className="text-right text-sm text-slate-600">
                    {m > 0 ? formatHoursMinutes(m) : "—"}
                  </span>
                ))}
                <span className={`text-right text-sm font-semibold ${tierClass}`}>
                  {formatHoursMinutes(r.totalOvertimeMinutes)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Só aparecem motoristas com hora extra no ano. Nome em <span className="text-red-600">vermelho</span> = 20%
        com mais hora extra no ano; em <span className="text-amber-600">âmbar</span> = próximos 40%. Ordenado por
        total do ano (mais hora extra primeiro) por padrão — clique numa coluna pra reordenar.
      </p>
    </div>
  );
}
