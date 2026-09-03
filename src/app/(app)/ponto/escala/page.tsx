import Link from "next/link";
import { addDays, addMonths, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { PONTUALIDADE_TOLERANCIA_MINUTOS } from "@/lib/pontoCompliance";
import { toMinutes } from "@/lib/time";
import PontoEscalaTable from "./PontoEscalaTable";
import type { PontoEscalaRow } from "./types";

// Diferenca entrada/saida vs escala, normalizada pro intervalo [-12h, 12h) —
// mesmo teto de plausibilidade ja usado em pontoCompliance.ts
// (PONTUALIDADE_MAX_PLAUSIVEL_MINUTOS), pra uma virada de dia entre horario
// programado e horario real (ex.: escala termina 23h, motorista bate 00:22)
// nao virar uma diferenca absurda de +23h em vez de +1h22.
function signedDiffMinutes(scheduled: string, actual: string): number {
  let diff = toMinutes(actual) - toMinutes(scheduled);
  if (diff > 12 * 60) diff -= 24 * 60;
  if (diff < -12 * 60) diff += 24 * 60;
  return diff;
}

function localDayKey(driverId: string, date: Date): string {
  return `${driverId}_${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "atraso", label: "Com atraso" },
  { value: "saida-antecipada", label: "Com saída antecipada" },
  { value: "sem-fim", label: "Sem horário de fim no SIAT" },
] as const;

export default async function PontoEscalaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; driverId?: string; status?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { mes, driverId, status } = await searchParams;

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);
  const monthEnd = addDays(endOfMonth(anchor), 1); // exclusivo
  const prevMonth = format(subMonths(monthStart, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthStart, 1), "yyyy-MM");

  const [drivers, escalas, entries] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.escala.findMany({
      where: {
        companyId: session.companyId,
        date: { gte: monthStart, lt: monthEnd },
        ...(driverId ? { driverId } : {}),
      },
      select: { id: true, driverId: true, date: true, startTime: true, endTime: true },
    }),
    prisma.timeClockEntry.findMany({
      where: {
        companyId: session.companyId,
        date: { gte: monthStart, lt: monthEnd },
        ...(driverId ? { driverId } : {}),
      },
      select: {
        id: true,
        driverId: true,
        date: true,
        clockIn: true,
        clockOut: true,
        intervaloInicio: true,
        intervaloFim: true,
      },
    }),
  ]);

  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const entryByKey = new Map(entries.map((e) => [localDayKey(e.driverId, e.date), e]));

  // Um motorista pode ter mais de 1 reserva no SIAT no mesmo dia (mais de 1
  // corrida) — agrupa por dia ANTES de comparar, senao cada reserva vira uma
  // linha comparada contra a MESMA (unica) batida de ponto do dia, gerando
  // diferenca sem sentido (bug real encontrado em produção: reserva das
  // 14h comparada contra entrada batida às 04h de uma reserva diferente do
  // mesmo dia). Início do dia = a reserva mais cedo; fim = a mais tarde
  // entre as que têm horário de término.
  const escalasByDay = new Map<string, typeof escalas>();
  for (const escala of escalas) {
    const key = localDayKey(escala.driverId, escala.date);
    const list = escalasByDay.get(key) ?? [];
    list.push(escala);
    escalasByDay.set(key, list);
  }

  const rows: PontoEscalaRow[] = [];
  for (const [key, dayEscalas] of escalasByDay) {
    const entry = entryByKey.get(key);
    if (!entry) continue; // sem batida correspondente — ver "dias sem registro" em Análise de riscos

    const sorted = [...dayEscalas].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    const startScheduled = sorted[0].startTime;
    const withEnd = dayEscalas.filter((e) => e.endTime);
    const endScheduled =
      withEnd.length > 0
        ? withEnd.reduce((latest, e) => (toMinutes(e.endTime!) > toMinutes(latest) ? e.endTime! : latest), withEnd[0].endTime!)
        : null;

    const first = sorted[0];
    rows.push({
      driverId: first.driverId,
      driverName: driverById.get(first.driverId)?.name ?? "—",
      dateISO: format(first.date, "yyyy-MM-dd"),
      startScheduled,
      startActual: entry.clockIn,
      startDiff: signedDiffMinutes(startScheduled, entry.clockIn),
      endScheduled,
      endActual: entry.clockOut,
      endDiff: endScheduled && entry.clockOut ? signedDiffMinutes(endScheduled, entry.clockOut) : null,
      entryId: entry.id,
      intervaloInicio: entry.intervaloInicio,
      intervaloFim: entry.intervaloFim,
      escalas: dayEscalas.map((e) => ({ id: e.id, startTime: e.startTime, endTime: e.endTime })),
    });
  }

  const filteredRows = rows.filter((r) => {
    if (status === "atraso") return r.startDiff > PONTUALIDADE_TOLERANCIA_MINUTOS;
    if (status === "saida-antecipada") return r.endDiff !== null && r.endDiff < -PONTUALIDADE_TOLERANCIA_MINUTOS;
    if (status === "sem-fim") return r.endScheduled === null;
    return true;
  });

  const atrasoCount = rows.filter((r) => r.startDiff > PONTUALIDADE_TOLERANCIA_MINUTOS).length;
  const saidaAntecipadaCount = rows.filter((r) => r.endDiff !== null && r.endDiff < -PONTUALIDADE_TOLERANCIA_MINUTOS).length;
  const semFimNoSiatCount = rows.filter((r) => r.endScheduled === null).length;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Ponto x Escala"
        subtitle="Horário batido no ponto lado a lado com o horário programado na escala (SIAT), dia a dia por motorista."
      />

      <div className="mb-6 flex items-center justify-between">
        <Link
          href={`/ponto/escala?mes=${prevMonth}${driverId ? `&driverId=${driverId}` : ""}${status ? `&status=${status}` : ""}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" /> Mês anterior
        </Link>
        <p className="text-sm font-medium text-slate-700">{format(monthStart, "MMMM/yyyy")}</p>
        <Link
          href={`/ponto/escala?mes=${nextMonth}${driverId ? `&driverId=${driverId}` : ""}${status ? `&status=${status}` : ""}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Próximo mês <ChevronRight className="h-4 w-4" />
        </Link>
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
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
          <select name="status" defaultValue={status ?? ""} className={inputClass}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <input type="hidden" name="mes" value={format(monthStart, "yyyy-MM")} />
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
      </form>

      <p className="mb-3 text-sm text-slate-500">
        {rows.length} dia(s) com escala e ponto batido no mês · {atrasoCount} atraso(s) · {saidaAntecipadaCount}{" "}
        saída(s) antecipada(s)
        {semFimNoSiatCount > 0 && ` · ${semFimNoSiatCount} dia(s) sem horário de fim programado no SIAT (saída não avaliada)`}
        {status && ` · mostrando ${filteredRows.length} com o filtro aplicado`}.
      </p>

      <PontoEscalaTable rows={filteredRows} tolerancia={PONTUALIDADE_TOLERANCIA_MINUTOS} />

      <p className="mt-3 text-xs text-slate-400">
        Clique numa linha pra ver as reservas do dia no SIAT e o registro de ponto. Arraste o cabeçalho de uma
        coluna pra reordenar, ou solte em &quot;Agrupar por&quot; pra agrupar (layout fica salvo só no seu
        navegador). Diferença calculada com tolerância de {PONTUALIDADE_TOLERANCIA_MINUTOS}min. Dias com escala
        mas sem batida de ponto (ausência) não aparecem aqui — ver{" "}
        <Link href="/ponto/analise" className="text-blue-700 hover:underline">
          Análise de riscos
        </Link>
        .
      </p>
    </div>
  );
}
