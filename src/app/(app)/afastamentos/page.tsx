import Link from "next/link";
import { addDays, addMonths, differenceInCalendarDays, format, startOfDay, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, CalendarOff, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import { isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import LeaveImportButton from "./LeaveImportButton";
import type { Prisma } from "@prisma/client";

const LEAVE_TYPE_LABELS: Record<string, string> = {
  folga: "Folga",
  atestado: "Atestado",
  ferias: "Férias",
  abono: "Abono",
};
const LEAVE_TYPE_TONE: Record<string, string> = {
  folga: "bg-blue-100 text-blue-700",
  atestado: "bg-red-100 text-red-700",
  ferias: "bg-purple-100 text-purple-700",
  abono: "bg-amber-100 text-amber-700",
};
const leaveLabel = (t: string) => LEAVE_TYPE_LABELS[t] ?? t;
const leaveTone = (t: string) => LEAVE_TYPE_TONE[t] ?? "bg-slate-100 text-slate-600";

const SORT_FIELDS = ["driver", "leaveType", "startDate", "endDate"] as const;
type SortField = (typeof SORT_FIELDS)[number];

export default async function AfastamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; tipo?: string; driverId?: string; sort?: string; dir?: string }>;
}) {
  const session = await requireSession();
  const { mes, tipo, driverId, sort, dir } = await searchParams;

  const today = startOfDay(new Date());
  const in7Days = addDays(today, 7);

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);
  const monthEnd = startOfMonth(addMonths(monthStart, 1));
  const prevMonth = format(subMonths(monthStart, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthStart, 1), "yyyy-MM");

  const [ativos, drivers, tipos] = await Promise.all([
    // Afastamentos que cobrem hoje — ordenados por quem volta primeiro,
    // mesmo padrao de alerta preditivo do resto do sistema (ex. vencimento
    // de CNH no painel).
    prisma.driverLeave.findMany({
      where: { companyId: session.companyId, startDate: { lte: today }, endDate: { gte: today } },
      include: { driver: { select: { name: true } } },
      orderBy: { endDate: "asc" },
    }),
    prisma.driver.findMany({
      where: { companyId: session.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.driverLeave.findMany({
      where: { companyId: session.companyId },
      select: { leaveType: true },
      distinct: ["leaveType"],
      orderBy: { leaveType: "asc" },
    }),
  ]);

  const retornandoLogo = ativos.filter((a) => a.endDate <= in7Days);

  const where: Prisma.DriverLeaveWhereInput = {
    companyId: session.companyId,
    startDate: { lt: monthEnd },
    endDate: { gte: monthStart },
  };
  if (tipo) where.leaveType = tipo;
  if (driverId) where.driverId = driverId;

  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "startDate";
  const sortDir = dir === "desc" ? "desc" : "asc";
  const orderBy: Prisma.DriverLeaveOrderByWithRelationInput =
    sortField === "driver"
      ? { driver: { name: sortDir } }
      : sortField === "leaveType"
        ? { leaveType: sortDir }
        : sortField === "endDate"
          ? { endDate: sortDir }
          : { startDate: sortDir };

  const registros = await prisma.driverLeave.findMany({
    where,
    include: { driver: { select: { name: true } } },
    orderBy,
  });

  const sortLinkParams = { mes: format(monthStart, "yyyy-MM"), tipo, driverId };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Afastamentos"
        subtitle="Folgas, atestados, férias e abonos dos motoristas, importados do TiqueTaque."
      />

      {isTiqueTaqueAvailable() && (
        <div className={`${cardClass} mb-6`}>
          <LeaveImportButton />
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-700">
            <CalendarOff className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{ativos.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Afastados hoje</p>
        </div>
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <CalendarClock className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{retornandoLogo.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Retornam em até 7 dias</p>
        </div>
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <ListChecks className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{registros.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Registros no mês selecionado</p>
        </div>
      </div>

      {ativos.length > 0 && (
        <div className={`${cardClass} mb-6`}>
          <p className="mb-3 text-sm font-semibold text-slate-800">Afastados agora</p>
          <ul className="flex flex-col gap-1">
            {ativos.map((a) => {
              const dias = differenceInCalendarDays(a.endDate, today);
              return (
                <li key={a.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm">
                  <span className="text-slate-700">{a.driver.name}</span>
                  <span className="flex items-center gap-2">
                    <span className={`${badgeClass} ${leaveTone(a.leaveType)}`}>{leaveLabel(a.leaveType)}</span>
                    <span className="text-xs text-slate-500">
                      {dias <= 0 ? "retorna hoje" : `retorna em ${dias}d (${format(a.endDate, "dd/MM")})`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/afastamentos?mes=${prevMonth}${tipo ? `&tipo=${tipo}` : ""}${driverId ? `&driverId=${driverId}` : ""}`}
            className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" /> Mês anterior
          </Link>
          <p className="text-sm font-medium text-slate-700">{format(monthStart, "MMMM/yyyy", { locale: ptBR })}</p>
          <Link
            href={`/afastamentos?mes=${nextMonth}${tipo ? `&tipo=${tipo}` : ""}${driverId ? `&driverId=${driverId}` : ""}`}
            className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Próximo mês <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="mes" value={format(monthStart, "yyyy-MM")} />
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
          <label className="mb-1 block text-xs font-medium text-slate-600">Tipo</label>
          <select name="tipo" defaultValue={tipo ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {tipos.map((t) => (
              <option key={t.leaveType} value={t.leaveType}>
                {leaveLabel(t.leaveType)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
        {(tipo || driverId) && (
          <Link href={`/afastamentos?mes=${format(monthStart, "yyyy-MM")}`} className="text-sm text-slate-500 hover:underline">
            Limpar filtro
          </Link>
        )}
      </form>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <SortableTh label="Motorista" field="driver" basePath="/afastamentos" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Tipo" field="leaveType" basePath="/afastamentos" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Início" field="startDate" basePath="/afastamentos" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Fim" field="endDate" basePath="/afastamentos" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <th className="px-4 py-3">Detalhes</th>
                <th className="px-4 py-3">Remunerado</th>
              </tr>
            </thead>
            <tbody>
              {registros.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Nenhum afastamento neste mês.
                  </td>
                </tr>
              )}
              {registros.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{r.driver.name}</td>
                  <td className="px-4 py-2.5">
                    <span className={`${badgeClass} ${leaveTone(r.leaveType)}`}>{leaveLabel(r.leaveType)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{format(r.startDate, "dd/MM/yyyy")}</td>
                  <td className="px-4 py-2.5 text-slate-600">{format(r.endDate, "dd/MM/yyyy")}</td>
                  <td className="px-4 py-2.5 text-slate-500">{r.details ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.paidLeave ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
