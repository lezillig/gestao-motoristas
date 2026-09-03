import Link from "next/link";
import { addDays, addMonths, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import ComboboxFilter from "@/components/ui/ComboboxFilter";
import { PONTUALIDADE_TOLERANCIA_MINUTOS } from "@/lib/pontoCompliance";
import { toMinutes } from "@/lib/time";
import PontoEscalaTable from "./PontoEscalaTable";
import type { PontoEscalaRow } from "./types";

// So aceita "H:mm"/"HH:mm" — protege contra Escala com startTime/endTime
// vazio ou malformado (confirmado real: o sync do SIAT grava sr.time sem
// validar, e string vazia passa pelo NOT NULL do Postgres numa boa; sem essa
// checagem, toMinutes("") vira NaN e corrompe silenciosamente o sort e a
// diferenca calculada — era a causa do "Início — SIAT" em branco + "NaNmin"
// vistos em produção).
function isValidTime(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value);
}

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
  { value: "sem-escala", label: "Tem ponto, sem escala no SIAT" },
  { value: "sem-ponto", label: "Tem escala, sem ponto batido" },
] as const;

type EscalaRaw = { id: string; driverId: string; date: Date; startTime: string; endTime: string | null };
type EntryRaw = {
  id: string;
  driverId: string;
  date: Date;
  clockIn: string;
  clockOut: string | null;
  intervaloInicio: string | null;
  intervaloFim: string | null;
};
type DayBucket = { driverId: string; date: Date; escalas: EscalaRaw[]; entry?: EntryRaw };

export default async function PontoEscalaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; driverId?: string; status?: string; empregador?: string; cargo?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { mes, driverId, status, empregador, cargo } = await searchParams;

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);
  const monthEnd = addDays(endOfMonth(anchor), 1); // exclusivo
  const prevMonth = format(subMonths(monthStart, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthStart, 1), "yyyy-MM");

  // Empregador/cargo sao campos do Driver, nao de Escala/TimeClockEntry —
  // filtra via relacao aninhada (`driver: {...}`) em vez de precisar
  // resolver uma lista de ids primeiro.
  const driverFilter = {
    ...(driverId ? { id: driverId } : {}),
    ...(empregador ? { empregador } : {}),
    ...(cargo ? { funcao: cargo } : {}),
  };

  const [drivers, empregadorRows, cargoRows, escalas, entries] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.driver.findMany({
      where: { companyId: session.companyId, empregador: { not: null } },
      select: { empregador: true },
      distinct: ["empregador"],
      orderBy: { empregador: "asc" },
    }),
    prisma.driver.findMany({
      where: { companyId: session.companyId, funcao: { not: null } },
      select: { funcao: true },
      distinct: ["funcao"],
      orderBy: { funcao: "asc" },
    }),
    prisma.escala.findMany({
      where: {
        companyId: session.companyId,
        date: { gte: monthStart, lt: monthEnd },
        driver: driverFilter,
      },
      select: { id: true, driverId: true, date: true, startTime: true, endTime: true },
    }),
    prisma.timeClockEntry.findMany({
      where: {
        companyId: session.companyId,
        date: { gte: monthStart, lt: monthEnd },
        driver: driverFilter,
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

  const empregadores = empregadorRows.map((r) => r.empregador!).sort((a, b) => a.localeCompare(b));
  const cargos = cargoRows.map((r) => r.funcao!).sort((a, b) => a.localeCompare(b));
  const driverById = new Map(drivers.map((d) => [d.id, d]));

  // Junta escala e ponto por dia num "outer join": um dia entra na lista se
  // tiver escala OU ponto batido — nao exige os dois (pedido explicito do
  // usuario: motorista com ponto batido mas sem escala sincronizada do SIAT
  // precisa aparecer, nao so ficar invisivel).
  const buckets = new Map<string, DayBucket>();
  function bucketFor(driverId2: string, date: Date): DayBucket {
    const key = localDayKey(driverId2, date);
    let b = buckets.get(key);
    if (!b) {
      b = { driverId: driverId2, date, escalas: [] };
      buckets.set(key, b);
    }
    return b;
  }
  for (const escala of escalas) bucketFor(escala.driverId, escala.date).escalas.push(escala);
  for (const entry of entries) bucketFor(entry.driverId, entry.date).entry = entry;

  const rows: PontoEscalaRow[] = [];
  for (const bucket of buckets.values()) {
    const { entry } = bucket;

    // Uma reserva com startTime vazio/invalido nao vira "sem horario" — vira
    // simplesmente ignorada aqui (mas ainda listada no drill-down, pra dar
    // visibilidade do dado esquisito em vez de escondê-lo por completo).
    const validEscalas = bucket.escalas.filter((e) => isValidTime(e.startTime));

    let startScheduled: string | null = null;
    let endScheduled: string | null = null;
    if (validEscalas.length > 0) {
      const sorted = [...validEscalas].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
      startScheduled = sorted[0].startTime;
      const withEnd = validEscalas.filter((e) => isValidTime(e.endTime));
      endScheduled =
        withEnd.length > 0
          ? withEnd.reduce((latest, e) => (toMinutes(e.endTime!) > toMinutes(latest) ? e.endTime! : latest), withEnd[0].endTime!)
          : null;
    }

    const startActual = entry?.clockIn ?? null;
    const endActual = entry?.clockOut ?? null;

    rows.push({
      driverId: bucket.driverId,
      driverName: driverById.get(bucket.driverId)?.name ?? "—",
      dateISO: format(bucket.date, "yyyy-MM-dd"),
      startScheduled,
      startActual,
      startDiff: startScheduled && startActual ? signedDiffMinutes(startScheduled, startActual) : null,
      endScheduled,
      endActual,
      endDiff: endScheduled && endActual ? signedDiffMinutes(endScheduled, endActual) : null,
      entryId: entry?.id ?? null,
      intervaloInicio: entry?.intervaloInicio ?? null,
      intervaloFim: entry?.intervaloFim ?? null,
      escalas: bucket.escalas.map((e) => ({ id: e.id, startTime: e.startTime, endTime: e.endTime })),
    });
  }

  const filteredRows = rows.filter((r) => {
    if (status === "atraso") return r.startDiff !== null && r.startDiff > PONTUALIDADE_TOLERANCIA_MINUTOS;
    if (status === "saida-antecipada") return r.endDiff !== null && r.endDiff < -PONTUALIDADE_TOLERANCIA_MINUTOS;
    if (status === "sem-fim") return r.startScheduled !== null && r.endScheduled === null;
    if (status === "sem-escala") return r.startScheduled === null && r.startActual !== null;
    if (status === "sem-ponto") return r.startActual === null && r.startScheduled !== null;
    return true;
  });

  const atrasoCount = rows.filter((r) => r.startDiff !== null && r.startDiff > PONTUALIDADE_TOLERANCIA_MINUTOS).length;
  const saidaAntecipadaCount = rows.filter((r) => r.endDiff !== null && r.endDiff < -PONTUALIDADE_TOLERANCIA_MINUTOS).length;
  const semEscalaCount = rows.filter((r) => r.startScheduled === null && r.startActual !== null).length;
  const semPontoCount = rows.filter((r) => r.startActual === null && r.startScheduled !== null).length;

  function monthNavParams(mesValue: string): URLSearchParams {
    const p = new URLSearchParams();
    p.set("mes", mesValue);
    if (driverId) p.set("driverId", driverId);
    if (status) p.set("status", status);
    if (empregador) p.set("empregador", empregador);
    if (cargo) p.set("cargo", cargo);
    return p;
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Ponto x Escala"
        subtitle="Horário batido no ponto lado a lado com o horário programado na escala (SIAT), dia a dia por motorista."
      />

      <div className="mb-6 flex items-center justify-between">
        <Link
          href={`/ponto/escala?${monthNavParams(prevMonth).toString()}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" /> Mês anterior
        </Link>
        <p className="text-sm font-medium text-slate-700">{format(monthStart, "MMMM/yyyy")}</p>
        <Link
          href={`/ponto/escala?${monthNavParams(nextMonth).toString()}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Próximo mês <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <div className="w-64">
          <ComboboxFilter
            name="driverId"
            label="Motorista"
            defaultValue={driverId}
            options={drivers.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>
        <div className="w-56">
          <ComboboxFilter
            name="empregador"
            label="Empregador"
            defaultValue={empregador}
            options={empregadores.map((e) => ({ value: e, label: e }))}
          />
        </div>
        <div className="w-56">
          <ComboboxFilter
            name="cargo"
            label="Cargo"
            defaultValue={cargo}
            options={cargos.map((c) => ({ value: c, label: c }))}
          />
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
        {rows.length} dia(s) no mês · {atrasoCount} atraso(s) · {saidaAntecipadaCount} saída(s) antecipada(s)
        {semEscalaCount > 0 && ` · ${semEscalaCount} dia(s) com ponto mas sem escala no SIAT`}
        {semPontoCount > 0 && ` · ${semPontoCount} dia(s) com escala mas sem ponto batido`}
        {status && ` · mostrando ${filteredRows.length} com o filtro aplicado`}.
      </p>

      <PontoEscalaTable rows={filteredRows} tolerancia={PONTUALIDADE_TOLERANCIA_MINUTOS} />

      <p className="mt-3 text-xs text-slate-400">
        Clique numa linha pra ver as reservas do dia no SIAT e o registro de ponto. Arraste o cabeçalho de uma
        coluna pra reordenar, ou solte em &quot;Agrupar por&quot; pra agrupar (layout fica salvo só no seu
        navegador). Diferença calculada com tolerância de {PONTUALIDADE_TOLERANCIA_MINUTOS}min. Mesmo indicador de
        atraso/absenteísmo agregado por motorista/mês está em{" "}
        <Link href="/ponto/analise" className="text-blue-700 hover:underline">
          Análise de riscos
        </Link>
        .
      </p>
    </div>
  );
}
