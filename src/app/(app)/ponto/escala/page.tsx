import Link from "next/link";
import { addDays, addMonths, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { PONTUALIDADE_TOLERANCIA_MINUTOS } from "@/lib/pontoCompliance";
import { toMinutes } from "@/lib/time";

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

function formatDiff(diff: number): string {
  if (diff === 0) return "no horário";
  return diff > 0 ? `+${diff}min` : `${diff}min`;
}

function localDayKey(driverId: string, date: Date): string {
  return `${driverId}_${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

type Row = {
  driverId: string;
  driverName: string;
  date: Date;
  startScheduled: string;
  startActual: string;
  startDiff: number;
  endScheduled: string | null;
  endActual: string | null;
  endDiff: number | null;
};

export default async function PontoEscalaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; driverId?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { mes, driverId } = await searchParams;

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
      select: { driverId: true, date: true, startTime: true, endTime: true },
    }),
    prisma.timeClockEntry.findMany({
      where: {
        companyId: session.companyId,
        date: { gte: monthStart, lt: monthEnd },
        ...(driverId ? { driverId } : {}),
      },
      select: { driverId: true, date: true, clockIn: true, clockOut: true },
    }),
  ]);

  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const entryByKey = new Map(entries.map((e) => [localDayKey(e.driverId, e.date), e]));

  const rows: Row[] = [];
  for (const escala of escalas) {
    const entry = entryByKey.get(localDayKey(escala.driverId, escala.date));
    if (!entry) continue; // sem batida correspondente — ver "dias sem registro" em Análise de riscos
    const endDiff = escala.endTime && entry.clockOut ? signedDiffMinutes(escala.endTime, entry.clockOut) : null;
    rows.push({
      driverId: escala.driverId,
      driverName: driverById.get(escala.driverId)?.name ?? "—",
      date: escala.date,
      startScheduled: escala.startTime,
      startActual: entry.clockIn,
      startDiff: signedDiffMinutes(escala.startTime, entry.clockIn),
      endScheduled: escala.endTime,
      endActual: entry.clockOut,
      endDiff,
    });
  }
  rows.sort((a, b) => b.date.getTime() - a.date.getTime() || a.driverName.localeCompare(b.driverName));

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
          href={`/ponto/escala?mes=${prevMonth}${driverId ? `&driverId=${driverId}` : ""}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" /> Mês anterior
        </Link>
        <p className="text-sm font-medium text-slate-700">{format(monthStart, "MMMM/yyyy")}</p>
        <Link
          href={`/ponto/escala?mes=${nextMonth}${driverId ? `&driverId=${driverId}` : ""}`}
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
        <input type="hidden" name="mes" value={format(monthStart, "yyyy-MM")} />
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
      </form>

      <p className="mb-3 text-sm text-slate-500">
        {rows.length} dia(s) com escala e ponto batido no mês · {atrasoCount} atraso(s) · {saidaAntecipadaCount}{" "}
        saída(s) antecipada(s)
        {semFimNoSiatCount > 0 && ` · ${semFimNoSiatCount} dia(s) sem horário de fim programado no SIAT (saída não avaliada)`}.
      </p>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Início — SIAT</th>
                <th className="px-4 py-3">Início — Ponto</th>
                <th className="px-4 py-3">Diferença</th>
                <th className="px-4 py-3">Fim — SIAT</th>
                <th className="px-4 py-3">Fim — Ponto</th>
                <th className="px-4 py-3">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    Nenhum dia com escala e ponto batido neste período.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const atrasado = r.startDiff > PONTUALIDADE_TOLERANCIA_MINUTOS;
                const saidaCedo = r.endDiff !== null && r.endDiff < -PONTUALIDADE_TOLERANCIA_MINUTOS;
                return (
                  <tr key={`${r.driverId}-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="max-w-[160px] px-4 py-3 text-xs font-medium leading-tight text-slate-800 line-clamp-2" title={r.driverName}>
                      {r.driverName}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{format(r.date, "dd/MM/yyyy")}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{r.startScheduled}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-800">{r.startActual}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`${badgeClass} ${atrasado ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                        {formatDiff(r.startDiff)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{r.endScheduled ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-800">{r.endActual ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.endDiff === null ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <span className={`${badgeClass} ${saidaCedo ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                          {formatDiff(r.endDiff)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Diferença calculada com tolerância de {PONTUALIDADE_TOLERANCIA_MINUTOS}min (variações menores não são
        destacadas). &quot;Fim — SIAT&quot; fica vazio quando a reserva do SIAT não trouxe horário de término
        (acontece em parte real das reservas) — nesses dias a saída não é avaliada. Dias com escala mas sem batida
        de ponto (ausência) não aparecem aqui — ver{" "}
        <Link href="/ponto/analise" className="text-blue-700 hover:underline">
          Análise de riscos
        </Link>
        .
      </p>
    </div>
  );
}
