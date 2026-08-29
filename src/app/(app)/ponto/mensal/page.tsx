import Link from "next/link";
import { addMonths, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { cardClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { buildMonthlyReport } from "@/lib/pontoMensal";
import { formatHoursMinutes, durationMinutes } from "@/lib/time";
import { buildSortHref, nextSortDir } from "@/lib/sort";
import { type WeekStripView } from "./DriverMonthRow";
import MonthlyDriverTable, { type MonthlyDriverRow } from "./MonthlyDriverTable";
import ExportBar from "./ExportBar";
import ViewToggle, { type VisaoHoras } from "@/components/ui/ViewToggle";

const TOTAL_SORT_KEY = "total";
const MOTORISTA_SORT_KEY = "motorista";
const semanaSortKey = (i: number) => `semana-${i}`;
const ORDINAIS = ["1ª", "2ª", "3ª", "4ª", "5ª", "6ª", "7ª"];
const ordinalDaSemana = (i: number) => ORDINAIS[i] ?? `${i + 1}ª`;

export default async function PontoMensalPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; sort?: string; dir?: string; visao?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR", "FOLHA");
  const { mes, sort, dir, visao: visaoParam } = await searchParams;
  const visao: VisaoHoras = visaoParam === "extras" ? "extras" : "totais";

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);
  const prevMonth = format(subMonths(monthStart, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthStart, 1), "yyyy-MM");
  const mesAtual = format(monthStart, "yyyy-MM");

  const report = await buildMonthlyReport(session.companyId, monthStart);

  // So entram motoristas com pelo menos 1 minuto de hora extra no mes —
  // pedido explicito do usuario, quem nao fez hora extra nao precisa
  // aparecer neste relatorio.
  const rows = report
    .filter((r) => r.totalOvertimeMinutes > 0)
    .map((r) => ({
    driverId: r.driverId,
    driverName: r.driverName,
    totalMinutes: r.totalMinutes,
    totalOvertimeMinutes: r.totalOvertimeMinutes,
    totalLabel: formatHoursMinutes(r.totalMinutes),
    totalOvertimeLabel: formatHoursMinutes(r.totalOvertimeMinutes),
    dailyLimitLabel: formatHoursMinutes(r.dailyLimitMinutes),
    weekMinutes: r.weeks.map((w) => w.subtotalMinutes),
    weekOvertimeMinutes: r.weeks.map((w) => w.subtotalOvertimeMinutes),
    weekTotals: r.weeks.map((w) => formatHoursMinutes(w.subtotalMinutes)),
    weekOvertimeTotals: r.weeks.map((w) => formatHoursMinutes(w.subtotalOvertimeMinutes)),
    weeks: r.weeks.map(
      (w, i): WeekStripView => ({
        label: `${ordinalDaSemana(i)} Semana · ${w.label}`,
        subtotal: formatHoursMinutes(visao === "extras" ? w.subtotalOvertimeMinutes : w.subtotalMinutes),
        days: w.days.map((d) =>
          d
            ? {
                dayKey: d.dayKey,
                label: format(d.date, "EEE dd/MM", { locale: ptBR }),
                dateLabel: format(d.date, "EEEE, dd/MM/yyyy", { locale: ptBR }),
                // Segue a visao selecionada (totais/extras) igual o resto da
                // pagina — turno aberto/sem registro mostra o mesmo rotulo
                // nas duas visoes, so o numero muda.
                value: d.open ? "em aberto" : d.hasEntry ? formatHoursMinutes(visao === "extras" ? d.overtimeMinutes : d.minutes) : "—",
                hasEntry: d.hasEntry,
                overtime: d.overtime,
                interjornadaViolation: d.interjornadaViolation,
                missingInterval: d.missingInterval,
                workedLabel: d.open ? "em aberto" : d.hasEntry ? formatHoursMinutes(d.minutes) : "—",
                overtimeLabel: formatHoursMinutes(d.overtimeMinutes),
                marcacoes: d.punchPairs.map((p) => ({
                  entrada: p.entrada,
                  saida: p.saida,
                  duracaoLabel: p.saida ? formatHoursMinutes(durationMinutes(p.entrada, p.saida)) : "em aberto",
                  entradaLocation: p.entradaLocation ?? null,
                  saidaLocation: p.saidaLocation ?? null,
                  entradaType: p.entradaType ?? null,
                  saidaType: p.saidaType ?? null,
                })),
                // Intervalo entre um par e o seguinte (ex.: almoço) — so
                // existe quando ha 2+ marcacoes fechadas no dia. Um dia com
                // 3+ pares pode ter mais de um intervalo (2+ pausas).
                intervalos: d.punchPairs.slice(0, -1).flatMap((p, i) => {
                  const next = d.punchPairs[i + 1];
                  if (!p.saida || !next) return [];
                  return [
                    {
                      inicio: p.saida,
                      fim: next.entrada,
                      duracaoLabel: formatHoursMinutes(durationMinutes(p.saida, next.entrada)),
                    },
                  ];
                }),
              }
            : null
        ),
      })
    ),
  }));

  const weekCount = report[0]?.weeks.length ?? 0;
  // "1ª Sem", "2ª Sem"... no cabecalho da coluna ("Sem" em vez de "Semana"
  // pra caber nas 92px por coluna sem quebrar linha) — o periodo exato (com
  // o sufixo "(semana parcial)" quando for o caso) fica no titulo (tooltip)
  // e dentro do drill on/off, que repete o mesmo ordinal por extenso antes
  // da data.
  const weekHeaderLabels = (report[0]?.weeks ?? []).map((w, i) => ({
    short: `${ordinalDaSemana(i)} Sem`,
    full: w.label,
  }));

  const sortDir = dir === "asc" ? "asc" : "desc";
  const sortableKeys = new Set([MOTORISTA_SORT_KEY, TOTAL_SORT_KEY, ...weekHeaderLabels.map((_, i) => semanaSortKey(i))]);
  // Ordena pelos numeros da visao ativa (extras ou totais) — clicar "1ª Sem"
  // no modo "Horas extras" ordena pela hora extra daquela semana, nao pelo
  // total trabalhado.
  const activeWeekMinutes = (r: (typeof rows)[number]) => (visao === "extras" ? r.weekOvertimeMinutes : r.weekMinutes);
  const activeTotalMinutes = (r: (typeof rows)[number]) => (visao === "extras" ? r.totalOvertimeMinutes : r.totalMinutes);
  const sortedRows =
    sort && sortableKeys.has(sort)
      ? [...rows].sort((a, b) => {
          let cmp: number;
          if (sort === MOTORISTA_SORT_KEY) cmp = a.driverName.localeCompare(b.driverName);
          else if (sort === TOTAL_SORT_KEY) cmp = activeTotalMinutes(a) - activeTotalMinutes(b);
          else {
            const idx = Number(sort.slice("semana-".length));
            cmp = (activeWeekMinutes(a)[idx] ?? 0) - (activeWeekMinutes(b)[idx] ?? 0);
          }
          return sortDir === "desc" ? -cmp : cmp;
        })
      : rows; // padrao: ja vem alfabetico do orderBy do Prisma

  // Faixa de risco por hora extra no mes — fixa (nao muda com a ordenacao
  // da tabela), calculada sobre o ranking geral de horas extras: os 20%
  // com mais hora extra ficam vermelhos, os proximos 40% ficam amarelos, o
  // resto sem destaque.
  const byOvertimeDesc = [...rows].sort((a, b) => b.totalOvertimeMinutes - a.totalOvertimeMinutes);
  const redCount = Math.ceil(byOvertimeDesc.length * 0.2);
  const amberCount = Math.ceil(byOvertimeDesc.length * 0.4);
  const tierByDriverId = new Map<string, "alto" | "medio" | "normal">(
    byOvertimeDesc.map((r, i) => [r.driverId, i < redCount ? "alto" : i < redCount + amberCount ? "medio" : "normal"])
  );

  const sortLinkParams = { mes: mesAtual, visao };
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
        subtitle="Horas trabalhadas ou horas extras por motorista no mês, com detalhamento diário e exportação."
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
        <div className="flex items-center gap-3">
          <ViewToggle basePath="/ponto/mensal" params={{ mes: mesAtual }} current={visao} />
          <ExportBar mes={mesAtual} />
        </div>
      </div>

      <div className={`${cardClass} overflow-hidden p-0`}>
        <div className="overflow-x-auto scroll-visible">
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
          <MonthlyDriverTable
            gridTemplateColumns={gridTemplateColumns}
            rows={sortedRows.map(
              (r): MonthlyDriverRow => ({
                driverId: r.driverId,
                driverName: r.driverName,
                totalLabel: visao === "extras" ? r.totalOvertimeLabel : r.totalLabel,
                dailyLimitLabel: r.dailyLimitLabel,
                weekTotals: visao === "extras" ? r.weekOvertimeTotals : r.weekTotals,
                weeks: r.weeks,
                tier: tierByDriverId.get(r.driverId) ?? "normal",
              })
            )}
          />
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Só aparecem motoristas com hora extra no mês. Nome em <span className="text-red-600">vermelho</span> = 20%
        com mais hora extra no mês; em <span className="text-amber-600">âmbar</span> = próximos 40%. Clique num
        motorista pra ver o detalhamento diário — âmbar no dia = turno com hora extra, borda vermelha = descanso
        insuficiente entre turnos ou intervalo intrajornada não registrado (ver{" "}
        <Link href="/ponto/analise" className="text-blue-600 hover:underline">
          Análise de riscos
        </Link>{" "}
        para o detalhe de cada ocorrência).
      </p>
    </div>
  );
}
