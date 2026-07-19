import Link from "next/link";
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Gavel, ScrollText, ShieldAlert } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import {
  EXCESSIVE_OVERTIME_MINUTES,
  MIN_INTERJORNADA_MINUTES,
  REGIME_12X36_REST_MINUTES,
  REGIME_12X36_WORK_MINUTES,
  findInterjornadaViolations,
  findMissingIntervalViolations,
  findMissingWeeklyRestViolations,
  overtimeMinutes,
  workedMinutes,
  type RiskLevel,
} from "@/lib/pontoCompliance";
import { driverDailyLimitMinutes, driverRegime12x36 } from "@/lib/convencao";
import { annotateJurisprudenceRisks, type DriverViolationSummary } from "@/lib/jurisprudencia";

type Categoria = "CLT" | "CCT/ACT" | "Jurisprudência";

type ViolationRow = {
  key: string;
  driverName: string;
  date: Date | null;
  categoria: Categoria;
  descricao: string;
  risco: RiskLevel;
  entryId: string | null;
};

const RISCO_TONE: Record<RiskLevel, string> = {
  alto: "bg-red-100 text-red-700",
  medio: "bg-amber-100 text-amber-700",
  baixo: "bg-slate-100 text-slate-600",
};

const RISCO_LABEL: Record<RiskLevel, string> = {
  alto: "Alto",
  medio: "Médio",
  baixo: "Baixo",
};

const CATEGORIA_ICON: Record<Categoria, React.ComponentType<{ className?: string }>> = {
  CLT: ShieldAlert,
  "CCT/ACT": ScrollText,
  Jurisprudência: Gavel,
};

export default async function AnaliseDeRiscosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; driverId?: string }>;
}) {
  const session = await requireSession();
  const { mes, driverId } = await searchParams;

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);
  const monthEnd = addDays(endOfMonth(anchor), 1); // exclusivo
  const prevMonth = format(subMonths(monthStart, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthStart, 1), "yyyy-MM");

  const drivers = await prisma.driver.findMany({
    where: { companyId: session.companyId, active: true },
    orderBy: { name: "asc" },
    include: { sindicato: { include: { convencoes: { include: { regras: true } } } } },
  });
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const driverName = (id: string) => driverById.get(id)?.name ?? "—";

  const entryWhere = {
    companyId: session.companyId,
    date: { gte: addDays(monthStart, -7), lt: monthEnd },
    ...(driverId ? { driverId } : {}),
  };
  const entriesWithLookback = await prisma.timeClockEntry.findMany({ where: entryWhere });
  const entriesInMonth = entriesWithLookback.filter(
    (e) => e.date >= monthStart && e.date < monthEnd
  );
  const entryIdsInMonth = new Set(entriesInMonth.map((e) => e.id));

  const dailyLimitByDriver = new Map(drivers.map((d) => [d.id, driverDailyLimitMinutes(d)]));
  const regime12x36ByDriver = new Map(drivers.map((d) => [d.id, driverRegime12x36(d)]));

  const rows: ViolationRow[] = [];
  const summaryByDriver = new Map<string, DriverViolationSummary>();
  const getSummary = (id: string): DriverViolationSummary => {
    let s = summaryByDriver.get(id);
    if (!s) {
      s = { driverId: id, missingIntervalCount: 0, interjornadaCount: 0, excessiveOvertimeCount: 0, missingRestStreaks: 0 };
      summaryByDriver.set(id, s);
    }
    return s;
  };

  // Hora extra: usa o limite negociado (ACT/CCT) ou o regime 12x36 quando
  // vigente; a categoria muda conforme a fonte do limite aplicado.
  for (const entry of entriesInMonth) {
    const regime = regime12x36ByDriver.get(entry.driverId);
    const limit = dailyLimitByDriver.get(entry.driverId);
    const effectiveLimit = regime?.ativo ? REGIME_12X36_WORK_MINUTES : limit?.minutes;
    const worked = workedMinutes(entry);
    const overtime = overtimeMinutes(worked, effectiveLimit);
    if (overtime <= 0) continue;

    const excessive = overtime > EXCESSIVE_OVERTIME_MINUTES;
    if (excessive) getSummary(entry.driverId).excessiveOvertimeCount++;

    // Override individual (regimeHoras) tem base legal propria (art. 59-A
    // CLT) e nao e uma convencao coletiva — categoriza como CLT em vez de
    // CCT/ACT nesse caso.
    const categoria: Categoria = regime?.individual ? "CLT" : regime?.ativo || limit?.source ? "CCT/ACT" : "CLT";
    const fonteLimite = regime?.ativo
      ? `regime 12x36 (${regime.source})`
      : limit?.source
        ? `ACT/CCT ${limit.source}`
        : "8h padrão";
    rows.push({
      key: `overtime-${entry.id}`,
      driverName: driverName(entry.driverId),
      date: entry.date,
      categoria,
      descricao: excessive
        ? `Hora extra excessiva: ${Math.round(overtime)} min além do limite (${fonteLimite}).`
        : `Hora extra: ${Math.round(overtime)} min além do limite (${fonteLimite}).`,
      risco: excessive ? "alto" : "baixo",
      entryId: entry.id,
    });
  }

  // Interjornada — 36h em regime 12x36, 11h no padrao.
  const interjornadaViolations = findInterjornadaViolations(
    entriesWithLookback,
    (driverId2) => (regime12x36ByDriver.get(driverId2)?.ativo ? REGIME_12X36_REST_MINUTES : MIN_INTERJORNADA_MINUTES)
  ).filter((v) => entryIdsInMonth.has(v.nextEntryId));
  for (const v of interjornadaViolations) {
    getSummary(v.driverId).interjornadaCount++;
    const entry = entriesInMonth.find((e) => e.id === v.nextEntryId);
    rows.push({
      key: `interjornada-${v.nextEntryId}`,
      driverName: driverName(v.driverId),
      date: entry?.date ?? null,
      categoria: "CLT",
      descricao: `Interjornada de apenas ${Math.round(v.gapMinutes / 60)}h${Math.round(v.gapMinutes % 60)}min entre turnos (mínimo exigido: ${regime12x36ByDriver.get(v.driverId)?.ativo ? "36h" : "11h"}).`,
      risco: "alto",
      entryId: v.nextEntryId,
    });
  }

  // Intervalo intrajornada ausente.
  const missingIntervalViolations = findMissingIntervalViolations(entriesInMonth);
  for (const v of missingIntervalViolations) {
    getSummary(v.driverId).missingIntervalCount++;
    const entry = entriesInMonth.find((e) => e.id === v.entryId);
    rows.push({
      key: `intervalo-${v.entryId}`,
      driverName: driverName(v.driverId),
      date: entry?.date ?? null,
      categoria: "CLT",
      descricao: `Turno de ${Math.round(v.workedMinutes / 60)}h sem intervalo intrajornada registrado.`,
      risco: "medio",
      entryId: v.entryId,
    });
  }

  // Descanso semanal (DSR) — 6 dias na escala 6x1, 5 na 5x2, 7 no generico.
  const escalaSemanalByDriver = new Map(drivers.map((d) => [d.id, d.escalaSemanal]));
  const maxConsecutiveDaysFor = (driverId2: string) => {
    const escala = escalaSemanalByDriver.get(driverId2);
    if (escala === "SEIS_UM") return 6;
    if (escala === "CINCO_DOIS") return 5;
    return 7;
  };
  const missingRestViolations = findMissingWeeklyRestViolations(
    entriesWithLookback,
    maxConsecutiveDaysFor
  ).filter((v) => entryIdsInMonth.has(v.entryId));
  for (const v of missingRestViolations) {
    const entry = entriesInMonth.find((e) => e.id === v.entryId);
    rows.push({
      key: `dsr-${v.entryId}`,
      driverName: driverName(v.driverId),
      date: entry?.date ?? null,
      categoria: "CLT",
      descricao: `${v.consecutiveDays}º dia seguido trabalhado sem folga.`,
      risco: "alto",
      entryId: v.entryId,
    });
  }
  for (const v of missingRestViolations) {
    const s = getSummary(v.driverId);
    s.missingRestStreaks = Math.max(s.missingRestStreaks, 1);
  }

  const jurisprudenceRisks = annotateJurisprudenceRisks([...summaryByDriver.values()]);
  for (const risk of jurisprudenceRisks) {
    rows.push({
      key: `juris-${risk.driverId}-${risk.id}`,
      driverName: driverName(risk.driverId),
      date: null,
      categoria: "Jurisprudência",
      descricao: `${risk.title} — ${risk.description} (${risk.citation})`,
      risco: risk.level,
      entryId: null,
    });
  }

  const riscoOrder: Record<RiskLevel, number> = { alto: 0, medio: 1, baixo: 2 };
  rows.sort((a, b) => {
    const byRisco = riscoOrder[a.risco] - riscoOrder[b.risco];
    if (byRisco !== 0) return byRisco;
    return (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
  });

  const countByCategoria = (categoria: Categoria) => rows.filter((r) => r.categoria === categoria).length;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Análise de riscos"
        subtitle="Marcações de ponto avaliadas sob três eixos: CLT, Convenção/Acordo Coletivo e decisões trabalhistas."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(["CLT", "CCT/ACT", "Jurisprudência"] as const).map((categoria) => {
          const Icon = CATEGORIA_ICON[categoria];
          return (
            <div key={categoria} className={cardClass}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-2xl font-semibold text-slate-900">{countByCategoria(categoria)}</p>
              <p className="mt-0.5 text-xs text-slate-500">Ocorrências — {categoria}</p>
            </div>
          );
        })}
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Motorista</label>
          <select name="driverId" defaultValue={driverId ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <input type="hidden" name="mes" value={format(monthStart, "yyyy-MM")} />
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
      </form>

      <div className="mb-4 flex items-center justify-between">
        <Link
          href={`/ponto/analise?mes=${prevMonth}${driverId ? `&driverId=${driverId}` : ""}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" /> Mês anterior
        </Link>
        <p className="text-sm font-medium text-slate-700">{format(monthStart, "MMMM/yyyy")}</p>
        <Link
          href={`/ponto/analise?mes=${nextMonth}${driverId ? `&driverId=${driverId}` : ""}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Próximo mês <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Risco</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma marcação de risco encontrada neste período.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.driverName}</td>
                  <td className="px-4 py-3 text-slate-600">{r.date ? format(r.date, "dd/MM/yyyy") : "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{r.categoria}</td>
                  <td className="px-4 py-3 text-slate-600">{r.descricao}</td>
                  <td className="px-4 py-3">
                    <span className={`${badgeClass} ${RISCO_TONE[r.risco]}`}>{RISCO_LABEL[r.risco]}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.entryId && (
                      <Link href={`/ponto/${r.entryId}`} className="text-xs font-medium text-blue-700 hover:underline">
                        Ver registro
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Os alertas de jurisprudência são informativos, baseados em padrões conhecidos — não substituem uma avaliação do setor jurídico.
      </p>
    </div>
  );
}
