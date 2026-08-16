import Link from "next/link";
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  startOfMonth,
  subMonths,
} from "date-fns";
import {
  AlarmClockOff,
  Banknote,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Coffee,
  Gavel,
  Hourglass,
  Moon,
  ScrollText,
  ShieldAlert,
  Trophy,
} from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import {
  EXCESSIVE_OVERTIME_MINUTES,
  MIN_INTERJORNADA_MINUTES,
  REGIME_12X36_REST_MINUTES,
  REGIME_12X36_WORK_MINUTES,
  findAbsences,
  findEarlyDepartureEvents,
  findInterjornadaViolations,
  findLatenessEvents,
  findMissingIntervalViolations,
  findMissingWeeklyRestViolations,
  intervalDurationMinutes,
  nightMinutes,
  overtimeMinutes,
  PONTUALIDADE_TOLERANCIA_MINUTOS,
  waitingMinutes,
  workedMinutes,
  type RiskLevel,
} from "@/lib/pontoCompliance";
import {
  driverDailyLimitMinutes,
  driverRegime12x36,
  nightPremiumCents,
  overtimeCostCents,
  waitingTimeIndemnityCents,
} from "@/lib/convencao";
import { annotateJurisprudenceRisks, type DriverViolationSummary } from "@/lib/jurisprudencia";
import { formatHoursMinutes } from "@/lib/time";

type Categoria = "CLT" | "CCT/ACT" | "Jurisprudência";

type ViolationRow = {
  key: string;
  driverId: string;
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

const ANALISE_SORT_FIELDS = ["motorista", "data", "categoria", "risco"] as const;
type AnaliseSortField = (typeof ANALISE_SORT_FIELDS)[number];

export default async function AnaliseDeRiscosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; driverId?: string; sort?: string; dir?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { mes, driverId, sort, dir } = await searchParams;

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

  const escalasInMonth = await prisma.escala.findMany({
    where: {
      companyId: session.companyId,
      date: { gte: monthStart, lt: monthEnd },
      ...(driverId ? { driverId } : {}),
    },
    select: { driverId: true, date: true, startTime: true, endTime: true },
  });

  const dailyLimitByDriver = new Map(drivers.map((d) => [d.id, driverDailyLimitMinutes(d)]));
  const regime12x36ByDriver = new Map(drivers.map((d) => [d.id, driverRegime12x36(d)]));

  // 3 meses anteriores ao selecionado, so pra alimentar o check de
  // supressao de hora extra habitual (Sumula 291, ver jurisprudencia.ts) —
  // consulta separada porque e uma janela bem maior que o lookback de 1 dia
  // ja usado pra interjornada.
  const priorMonthsStart = startOfMonth(subMonths(monthStart, 3));
  const priorMonthsEntries = await prisma.timeClockEntry.findMany({
    where: {
      companyId: session.companyId,
      date: { gte: priorMonthsStart, lt: monthStart },
      ...(driverId ? { driverId } : {}),
    },
  });
  const priorOvertimeByDriverMonth = new Map<string, number>();
  for (const entry of priorMonthsEntries) {
    const regime = regime12x36ByDriver.get(entry.driverId);
    const limit = dailyLimitByDriver.get(entry.driverId);
    const effectiveLimit = regime?.ativo ? REGIME_12X36_WORK_MINUTES : limit?.minutes;
    const overtime = overtimeMinutes(workedMinutes(entry), effectiveLimit);
    const key = `${entry.driverId}_${format(entry.date, "yyyy-MM")}`;
    priorOvertimeByDriverMonth.set(key, (priorOvertimeByDriverMonth.get(key) ?? 0) + overtime);
  }
  const priorMonthKeys = [3, 2, 1].map((n) => format(subMonths(monthStart, n), "yyyy-MM"));
  const currentOvertimeByDriver = new Map<string, number>();

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

  // Resumo agregado (cards no topo, inspirados no benchmarking de mercado):
  // total de horas extras + custo financeiro, turnos >10h, e as metricas de
  // intervalo/escala calculadas mais abaixo.
  let totalOvertimeMinutes = 0;
  let totalCostCents = 0;
  let hasAnyCost = false;
  const over10hCount = entriesInMonth.filter((e) => (workedMinutes(e) ?? 0) > 600).length;

  // Adicional noturno (art. 73 CLT) — minutos trabalhados entre 22h e 5h,
  // independente de haver ou nao hora extra no turno.
  let totalNightMinutes = 0;
  let totalNightCostCents = 0;
  let hasAnyNightCost = false;
  for (const entry of entriesInMonth) {
    const night = nightMinutes(entry);
    if (night <= 0) continue;
    totalNightMinutes += night;
    const driverForNight = driverById.get(entry.driverId);
    if (driverForNight) {
      const cost = nightPremiumCents(driverForNight, night);
      if (cost !== null) {
        totalNightCostCents += cost;
        hasAnyNightCost = true;
      }
    }
  }

  // Tempo de espera (art. 235-C, §§8-9, Lei 13.103/2015) — nao e jornada
  // nem hora extra, so lancamento manual (ver waitingMinutes/PontoForm).
  let totalWaitingMinutes = 0;
  let totalWaitingCostCents = 0;
  let hasAnyWaitingCost = false;
  for (const entry of entriesInMonth) {
    const waiting = waitingMinutes(entry);
    if (waiting <= 0) continue;
    totalWaitingMinutes += waiting;
    const driverForWaiting = driverById.get(entry.driverId);
    if (driverForWaiting) {
      const cost = waitingTimeIndemnityCents(driverForWaiting, waiting);
      if (cost !== null) {
        totalWaitingCostCents += cost;
        hasAnyWaitingCost = true;
      }
    }
  }

  // Hora extra: usa o limite negociado (ACT/CCT) ou o regime 12x36 quando
  // vigente; a categoria muda conforme a fonte do limite aplicado.
  for (const entry of entriesInMonth) {
    const regime = regime12x36ByDriver.get(entry.driverId);
    const limit = dailyLimitByDriver.get(entry.driverId);
    const effectiveLimit = regime?.ativo ? REGIME_12X36_WORK_MINUTES : limit?.minutes;
    const worked = workedMinutes(entry);
    const overtime = overtimeMinutes(worked, effectiveLimit);
    if (overtime <= 0) continue;

    totalOvertimeMinutes += overtime;
    currentOvertimeByDriver.set(entry.driverId, (currentOvertimeByDriver.get(entry.driverId) ?? 0) + overtime);
    const driverForCost = driverById.get(entry.driverId);
    if (driverForCost) {
      const cost = overtimeCostCents(driverForCost, overtime);
      if (cost !== null) {
        totalCostCents += cost;
        hasAnyCost = true;
      }
    }

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
      driverId: entry.driverId,
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
      driverId: v.driverId,
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
      driverId: v.driverId,
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
      driverId: v.driverId,
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

  // Card "Intervalo": mesmo layout de 3 numeros ja usado por concorrentes
  // (benchmarking) — turnos com intervalo <1h, turnos sem NENHUM intervalo
  // registrado (independente da duracao do turno), e turnos >=6h sem
  // intervalo (esse ultimo e exatamente findMissingIntervalViolations).
  const shortIntervalCount = entriesInMonth.filter((e) => {
    const dur = intervalDurationMinutes(e);
    return dur !== null && dur < 60;
  }).length;
  const noIntervalCount = entriesInMonth.filter((e) => !e.intervaloInicio || !e.intervaloFim).length;

  // Card "Escala": violacoes de interjornada (ja computado acima) + dias
  // sem registro (escala planejada sem TimeClockEntry correspondente) e o
  // % de absenteismo sobre o total de escalas do periodo.
  const absences = findAbsences(escalasInMonth, entriesInMonth);
  const absenteeismPercent = escalasInMonth.length > 0 ? (absences.length / escalasInMonth.length) * 100 : 0;

  // Atrasos e saidas antecipadas: cruza a Escala (horario programado) com o
  // TimeClockEntry real do mesmo dia — angulo diferente dos outros checks
  // (que sao todos violacao legal); este e um indicador de assiduidade,
  // sem citacao de CLT/CCT, por isso nao vira linha na tabela de risco.
  const latenessEvents = findLatenessEvents(escalasInMonth, entriesInMonth);
  const earlyDepartureEvents = findEarlyDepartureEvents(escalasInMonth, entriesInMonth);
  const totalLateMinutes = latenessEvents.reduce((sum, e) => sum + e.lateMinutes, 0);
  const totalEarlyMinutes = earlyDepartureEvents.reduce((sum, e) => sum + e.earlyMinutes, 0);

  // Completude do controle de ponto (Sumula 338, I, TST): empresas que nao
  // mantem controle de ponto regular tem presuncao relativa de veracidade
  // da jornada alegada pelo MOTORISTA contra elas — este indicador mede,
  // por motorista, quantos dos dias efetivamente escalados no mes tem um
  // registro completo (turno fechado + intervalo registrado quando exigido)
  // — util pra avaliar exposicao de risco antes de uma reclamacao, nao so
  // listar ocorrencias pontuais como o resto da tabela ja faz.
  const missingIntervalEntryIds = new Set(missingIntervalViolations.map((v) => v.entryId));
  const escalaDaysByDriver = new Map<string, Set<string>>();
  for (const escala of escalasInMonth) {
    const key = `${escala.date.getFullYear()}-${escala.date.getMonth()}-${escala.date.getDate()}`;
    const set = escalaDaysByDriver.get(escala.driverId) ?? new Set<string>();
    set.add(key);
    escalaDaysByDriver.set(escala.driverId, set);
  }
  const completeDaysByDriver = new Map<string, number>();
  for (const entry of entriesInMonth) {
    const complete = workedMinutes(entry) !== null && !missingIntervalEntryIds.has(entry.id);
    if (complete) {
      completeDaysByDriver.set(entry.driverId, (completeDaysByDriver.get(entry.driverId) ?? 0) + 1);
    }
  }
  const completude = drivers
    .map((driver) => {
      const expected = escalaDaysByDriver.get(driver.id)?.size ?? 0;
      if (expected === 0) return null;
      const complete = completeDaysByDriver.get(driver.id) ?? 0;
      return { driverId: driver.id, name: driver.name, expected, complete, percent: (complete / expected) * 100 };
    })
    .filter((c): c is { driverId: string; name: string; expected: number; complete: number; percent: number } => c !== null && c.percent < 100)
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 8);

  // Anexa o historico de 3 meses (Sumula 291) pra todo motorista, mesmo os
  // sem nenhuma outra violacao no mes — a supressao habitual e detectada
  // justamente pela QUEDA pra hora extra baixa/zero, entao o motorista
  // costuma nao ter nenhuma outra ocorrencia no mes selecionado.
  for (const driver of drivers) {
    const summary = getSummary(driver.id);
    summary.priorMonthsOvertimeMinutes = priorMonthKeys.map(
      (k) => priorOvertimeByDriverMonth.get(`${driver.id}_${k}`) ?? 0
    );
    summary.currentMonthOvertimeMinutes = currentOvertimeByDriver.get(driver.id) ?? 0;
  }

  const jurisprudenceRisks = annotateJurisprudenceRisks([...summaryByDriver.values()]);
  for (const risk of jurisprudenceRisks) {
    rows.push({
      key: `juris-${risk.driverId}-${risk.id}`,
      driverId: risk.driverId,
      driverName: driverName(risk.driverId),
      date: null,
      categoria: "Jurisprudência",
      descricao: `${risk.title} — ${risk.description} (${risk.citation})`,
      risco: risk.level,
      entryId: null,
    });
  }

  const riscoOrder: Record<RiskLevel, number> = { alto: 0, medio: 1, baixo: 2 };
  const sortField: AnaliseSortField | null = ANALISE_SORT_FIELDS.includes(sort as AnaliseSortField)
    ? (sort as AnaliseSortField)
    : null;
  const sortDir = dir === "desc" ? "desc" : "asc";

  if (sortField) {
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortField === "motorista") cmp = a.driverName.localeCompare(b.driverName);
      else if (sortField === "data") cmp = (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0);
      else if (sortField === "categoria") cmp = a.categoria.localeCompare(b.categoria);
      else cmp = riscoOrder[a.risco] - riscoOrder[b.risco];
      return sortDir === "desc" ? -cmp : cmp;
    });
  } else {
    // Padrao sem clique: risco alto>medio>baixo, depois data mais recente primeiro.
    rows.sort((a, b) => {
      const byRisco = riscoOrder[a.risco] - riscoOrder[b.risco];
      if (byRisco !== 0) return byRisco;
      return (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
    });
  }

  // Ranking "motoristas com mais ocorrencias de risco" — mesmo padrao de
  // leaderboard ja usado em src/app/(app)/telemetria/page.tsx. Peso maior
  // pro DSR (falta de descanso semanal e a violacao mais grave).
  const ranking = [...summaryByDriver.entries()]
    .map(([id, s]) => ({
      id,
      name: driverName(id),
      score: s.missingIntervalCount + s.interjornadaCount + s.excessiveOvertimeCount + s.missingRestStreaks * 3,
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Clique no ranking funciona como drop on/off: clicar filtra pelo
  // motorista (mesmo parametro driverId do formulario abaixo); clicar de
  // novo no mesmo motorista ja selecionado remove o filtro.
  const rankingHref = (id: string) => {
    const params = new URLSearchParams();
    params.set("mes", format(monthStart, "yyyy-MM"));
    if (driverId !== id) params.set("driverId", id);
    return `/ponto/analise?${params.toString()}`;
  };

  const sortLinkParams = { mes: format(monthStart, "yyyy-MM"), driverId };
  const countByCategoria = (categoria: Categoria) => rows.filter((r) => r.categoria === categoria).length;
  // Dias-motorista distintos com pelo menos 1 ocorrencia CLT/CCT (rows com
  // `date`, ou seja, excluindo as de jurisprudencia — essas sao por
  // motorista/mes, sem data especifica, ver push acima).
  const diasComPendencias = new Set(
    rows.filter((r) => r.date).map((r) => `${r.driverId}_${r.date!.toISOString().slice(0, 10)}`)
  ).size;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Análise de riscos"
        subtitle="Marcações de ponto avaliadas sob três eixos: CLT, Convenção/Acordo Coletivo e decisões trabalhistas."
      />

      <div className="mb-6 flex items-center justify-between">
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

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
            <Banknote className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Horas extras</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatHoursMinutes(totalOvertimeMinutes)}</p>
          <p className="text-xs text-slate-500">em horas extras</p>
          <div className="mt-3 flex items-end justify-between border-t border-slate-100 pt-3 text-sm">
            <div>
              <p className="font-semibold text-slate-900">
                {hasAnyCost
                  ? (totalCostCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                  : "—"}
              </p>
              <p className="text-xs text-slate-500">
                {hasAnyCost ? "em horas extras" : "configure o valor-hora dos motoristas"}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-slate-900">{over10hCount}</p>
              <p className="text-xs text-slate-500">excederam 10h por dia</p>
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
            <Coffee className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Intervalo</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{shortIntervalCount}</p>
          <p className="text-xs text-slate-500">fizeram menos de 1 hora de intervalo</p>
          <div className="mt-3 flex items-end justify-between border-t border-slate-100 pt-3 text-sm">
            <div>
              <p className="font-semibold text-slate-900">{noIntervalCount}</p>
              <p className="text-xs text-slate-500">não fizeram intervalo</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-slate-900">{missingIntervalViolations.length}</p>
              <p className="text-xs text-slate-500">excederam 6h sem intervalo</p>
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
            <CalendarX className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Escala</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{interjornadaViolations.length}</p>
          <p className="text-xs text-slate-500">menos de 11h interjornada</p>
          <div className="mt-3 flex items-end justify-between border-t border-slate-100 pt-3 text-sm">
            <div>
              <p className="font-semibold text-slate-900">{absenteeismPercent.toFixed(2)}%</p>
              <p className="text-xs text-slate-500">Absenteísmo</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-slate-900">{absences.length}</p>
              <p className="text-xs text-slate-500">dias sem registros</p>
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-slate-100">
            <Moon className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Adicional noturno</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatHoursMinutes(totalNightMinutes)}</p>
          <p className="text-xs text-slate-500">trabalhados entre 22h e 5h (art. 73 CLT)</p>
          <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
            <p className="font-semibold text-slate-900">
              {hasAnyNightCost
                ? (totalNightCostCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                : "—"}
            </p>
            <p className="text-xs text-slate-500">
              {hasAnyNightCost ? "em adicional noturno" : "configure o valor-hora dos motoristas"}
            </p>
          </div>
        </div>

        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <Hourglass className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Tempo de espera</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatHoursMinutes(totalWaitingMinutes)}</p>
          <p className="text-xs text-slate-500">aguardando carga/embarque (art. 235-C, §§8-9 Lei 13.103/2015)</p>
          <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
            <p className="font-semibold text-slate-900">
              {hasAnyWaitingCost
                ? (totalWaitingCostCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                : "—"}
            </p>
            <p className="text-xs text-slate-500">
              {hasAnyWaitingCost ? "em indenização de espera" : "configure o valor-hora dos motoristas"}
            </p>
          </div>
        </div>

        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
            <AlarmClockOff className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Atrasos</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{latenessEvents.length}</p>
          <p className="text-xs text-slate-500">
            {latenessEvents.length > 0 ? `${formatHoursMinutes(totalLateMinutes)} de atraso somado` : "vs. horário da escala"}
          </p>
          <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
            <p className="font-semibold text-slate-900">{earlyDepartureEvents.length}</p>
            <p className="text-xs text-slate-500">
              saída{earlyDepartureEvents.length === 1 ? "" : "s"} antecipada
              {earlyDepartureEvents.length === 1 ? "" : "s"}
              {earlyDepartureEvents.length > 0 ? ` (${formatHoursMinutes(totalEarlyMinutes)})` : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
            <CalendarX className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{diasComPendencias}</p>
          <p className="mt-0.5 text-xs text-slate-500">Dias com pendências</p>
        </div>
      </div>

      {ranking.length > 0 && (
        <div className={`${cardClass} mb-6`}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Trophy className="h-4 w-4 text-amber-500" /> Motoristas com mais ocorrências de risco
          </h2>
          <ul className="flex flex-col gap-1">
            {ranking.map((r) => {
              const selecionado = driverId === r.id;
              return (
                <li key={r.id}>
                  <Link
                    href={rankingHref(r.id)}
                    className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      selecionado ? "bg-blue-50 ring-1 ring-blue-300" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className={selecionado ? "font-medium text-blue-700" : "text-slate-700"}>{r.name}</span>
                    <span className={`${badgeClass} bg-red-100 text-red-700`}>{r.score} ocorrência(s)</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {completude.length > 0 && (
        <div className={`${cardClass} mb-6`}>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ClipboardCheck className="h-4 w-4 text-slate-500" /> Completude do controle de ponto
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            % dos dias escalados no mês com registro de ponto completo (turno fechado + intervalo registrado quando
            exigido) — abaixo de 100% aumenta o risco de inversão do ônus da prova a favor do motorista em eventual
            reclamação (Súmula 338, I, TST).
          </p>
          <ul className="flex flex-col gap-1">
            {completude.map((c) => (
              <li key={c.driverId} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm">
                <span className="text-slate-700">{c.name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">
                    {c.complete}/{c.expected} dias
                  </span>
                  <span
                    className={`${badgeClass} ${
                      c.percent < 70 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {c.percent.toFixed(0)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

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

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <SortableTh label="Motorista" field="motorista" basePath="/ponto/analise" currentParams={sortLinkParams} currentSort={sortField ?? undefined} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Data" field="data" basePath="/ponto/analise" currentParams={sortLinkParams} currentSort={sortField ?? undefined} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Categoria" field="categoria" basePath="/ponto/analise" currentParams={sortLinkParams} currentSort={sortField ?? undefined} currentDir={sortDir} className="px-4 py-3" />
                <th className="px-4 py-3">Descrição</th>
                <SortableTh label="Risco" field="risco" basePath="/ponto/analise" currentParams={sortLinkParams} currentSort={sortField ?? undefined} currentDir={sortDir} className="px-4 py-3" />
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
                  <td className="max-w-[160px] px-4 py-3 text-xs font-medium leading-tight text-slate-800 line-clamp-2" title={r.driverName}>
                    {r.driverName}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{r.date ? format(r.date, "dd/MM/yyyy") : "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{r.categoria}</td>
                  <td className="max-w-[260px] px-4 py-3 text-xs leading-tight text-slate-600">{r.descricao}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`${badgeClass} ${RISCO_TONE[r.risco]}`}>{RISCO_LABEL[r.risco]}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
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
        Os alertas de jurisprudência são informativos, baseados em padrões conhecidos — não substituem uma avaliação do setor jurídico. O
        card "Atrasos" é um indicador de assiduidade (horário real batido vs. horário programado na escala, com
        tolerância de {PONTUALIDADE_TOLERANCIA_MINUTOS}min), não uma violação legal — por isso não aparece na tabela
        de ocorrências abaixo.
      </p>
    </div>
  );
}
