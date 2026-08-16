import Link from "next/link";
import { addDays, addMonths, differenceInCalendarDays, format, startOfDay, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, CalendarClock, CalendarOff, CalendarX2, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import { isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import LeaveImportButton from "./LeaveImportButton";
import KpiCard, { type KpiDetailRow } from "@/components/ui/KpiCard";
import { checkFolgaCompensada, findFeriasVencidas, folgaIssueLabel, parseDataReferencia } from "@/lib/afastamentoCompliance";
import type { Prisma } from "@prisma/client";

const DRIVER_CCT_INCLUDE = {
  sindicato: { include: { convencoes: { include: { regras: true } } } },
} satisfies Prisma.DriverInclude;

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
  const session = await requireRole("ADMIN", "GESTOR", "FOLHA");
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
      include: { driver: { include: DRIVER_CCT_INCLUDE } },
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

  // Ferias vencidas (art. 137 CLT, dobra) — independente do mes selecionado
  // no filtro abaixo, e um status "hoje" por motorista, mesmo espirito do
  // card "Afastados agora". So considera motoristas com admissao cadastrada
  // (campo opcional) e ativos.
  const [driversComAdmissao, feriasHistorico] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId: session.companyId, active: true, admissao: { not: null } },
      select: { id: true, name: true, admissao: true },
    }),
    prisma.driverLeave.findMany({
      where: { companyId: session.companyId, leaveType: "ferias" },
      select: { driverId: true, startDate: true },
    }),
  ]);
  const feriasByDriver = new Map<string, Date[]>();
  for (const f of feriasHistorico) {
    const list = feriasByDriver.get(f.driverId) ?? [];
    list.push(f.startDate);
    feriasByDriver.set(f.driverId, list);
  }
  const feriasVencidas = driversComAdmissao.flatMap((d) =>
    findFeriasVencidas(d.id, d.admissao, feriasByDriver.get(d.id) ?? [], today).map((v) => ({ ...v, driverName: d.name }))
  );

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
    include: { driver: { include: DRIVER_CCT_INCLUDE } },
    orderBy,
  });

  // Checagem de legalidade das "folgas compensadas": cruza a data de hora
  // extra citada no texto (`details`, cru do TiqueTaque, ex. "FOLGA
  // COMPENSADA 02/08") com o ponto real do motorista naquele dia — ver
  // src/lib/afastamentoCompliance.ts pros criterios (art. 59 CLT, Sumula
  // 85 TST). So se aplica a folga; atestado/ferias/abono nao tem checagem
  // automatica aqui (ver comentario no lib).
  const leavesToCheck = [...ativos, ...registros];
  const referencias = leavesToCheck
    .map((l) => {
      if (l.leaveType !== "folga") return null;
      const date = parseDataReferencia(l.details, l.startDate);
      return date ? { driverId: l.driverId, date } : null;
    })
    .filter((r): r is { driverId: string; date: Date } => r !== null);
  const refEntries =
    referencias.length > 0
      ? await prisma.timeClockEntry.findMany({
          where: { companyId: session.companyId, OR: referencias.map((r) => ({ driverId: r.driverId, date: r.date })) },
        })
      : [];
  const entryByKey = new Map(refEntries.map((e) => [`${e.driverId}_${format(e.date, "yyyy-MM-dd")}`, e]));

  function complianceFor(l: (typeof registros)[number]) {
    if (l.leaveType !== "folga") return null;
    const ref = parseDataReferencia(l.details, l.startDate);
    const entry = ref ? entryByKey.get(`${l.driverId}_${format(ref, "yyyy-MM-dd")}`) : undefined;
    return checkFolgaCompensada(l.leaveType, l.details, l.startDate, l.driver, entry);
  }

  // Linhas de detalhe pro modal de duplo clique de cada KPI (mesmo padrao
  // ja usado em /ponto) — reaproveita leaveTone/leaveLabel e o calculo de
  // "retorna em Xd" ja feitos acima pra lista de afastados agora.
  const ativosRows: KpiDetailRow[] = ativos.map((a) => {
    const dias = differenceInCalendarDays(a.endDate, today);
    return {
      id: a.id,
      href: `/afastamentos?driverId=${a.driverId}`,
      cells: [a.driver.name, leaveLabel(a.leaveType), dias <= 0 ? "hoje" : `em ${dias}d (${format(a.endDate, "dd/MM")})`],
    };
  });
  const retornandoRows: KpiDetailRow[] = retornandoLogo.map((a) => {
    const dias = differenceInCalendarDays(a.endDate, today);
    return {
      id: a.id,
      href: `/afastamentos?driverId=${a.driverId}`,
      cells: [a.driver.name, leaveLabel(a.leaveType), dias <= 0 ? "hoje" : `em ${dias}d (${format(a.endDate, "dd/MM")})`],
    };
  });
  const registrosRows: KpiDetailRow[] = registros.map((r) => ({
    id: r.id,
    href: `/afastamentos?driverId=${r.driverId}`,
    cells: [r.driver.name, leaveLabel(r.leaveType), format(r.startDate, "dd/MM/yyyy"), format(r.endDate, "dd/MM/yyyy")],
  }));

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
        <KpiCard
          icon={<CalendarOff className="h-4 w-4" />}
          iconBgClass="bg-red-100 text-red-700"
          value={ativos.length}
          label="Afastados hoje"
          columns={["Motorista", "Tipo", "Retorna"]}
          rows={ativosRows}
          emptyMessage="Nenhum motorista afastado hoje."
        />
        <KpiCard
          icon={<CalendarClock className="h-4 w-4" />}
          iconBgClass="bg-amber-100 text-amber-700"
          value={retornandoLogo.length}
          label="Retornam em até 7 dias"
          columns={["Motorista", "Tipo", "Retorna"]}
          rows={retornandoRows}
          emptyMessage="Nenhum motorista retornando nos próximos 7 dias."
        />
        <KpiCard
          icon={<ListChecks className="h-4 w-4" />}
          iconBgClass="bg-slate-100 text-slate-600"
          value={registros.length}
          label="Registros no mês selecionado"
          columns={["Motorista", "Tipo", "Início", "Fim"]}
          rows={registrosRows}
          emptyMessage="Nenhum registro neste mês."
        />
      </div>

      {feriasVencidas.length > 0 && (
        <div className={`${cardClass} mb-6 border-red-200`}>
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-red-700">
            <CalendarX2 className="h-4 w-4" /> Férias vencidas — sujeitas a dobra (art. 137 CLT)
          </p>
          <p className="mb-3 text-xs text-slate-500">
            Nenhuma férias registrada dentro do período concessivo (24 meses a partir do início do período
            aquisitivo). Quando concedidas, devem ser pagas em dobro.
          </p>
          <ul className="flex flex-col gap-1">
            {feriasVencidas.map((v, i) => (
              <li key={i} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm">
                <span className="font-medium text-red-600">{v.driverName}</span>
                <span className="text-xs text-slate-500">
                  Período aquisitivo {format(v.periodoAquisitivoInicio, "dd/MM/yyyy")} –{" "}
                  {format(v.periodoAquisitivoFim, "dd/MM/yyyy")} · prazo venceu em{" "}
                  {format(v.prazoConcessivo, "dd/MM/yyyy")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ativos.length > 0 && (
        <div className={`${cardClass} mb-6`}>
          <p className="mb-3 text-sm font-semibold text-slate-800">Afastados agora</p>
          <ul className="flex flex-col gap-1">
            {ativos.map((a) => {
              const dias = differenceInCalendarDays(a.endDate, today);
              const compliance = complianceFor(a);
              const hasRisk = !!compliance && compliance.issues.length > 0;
              return (
                <li key={a.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm">
                  <span
                    className={hasRisk ? "font-medium text-red-600" : "text-slate-700"}
                    title={hasRisk ? compliance!.issues.map(folgaIssueLabel).join(" · ") : undefined}
                  >
                    {a.driver.name}
                  </span>
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
              {registros.map((r) => {
                const compliance = complianceFor(r);
                const hasRisk = !!compliance && compliance.issues.length > 0;
                const riskTitle = hasRisk ? compliance!.issues.map(folgaIssueLabel).join(" · ") : undefined;
                return (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td
                      className={`px-4 py-2.5 font-medium ${hasRisk ? "text-red-600" : "text-slate-800"}`}
                      title={riskTitle}
                    >
                      {r.driver.name}
                      {hasRisk && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 align-text-bottom" />}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`${badgeClass} ${leaveTone(r.leaveType)}`}>{leaveLabel(r.leaveType)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{format(r.startDate, "dd/MM/yyyy")}</td>
                    <td className="px-4 py-2.5 text-slate-600">{format(r.endDate, "dd/MM/yyyy")}</td>
                    <td className={`px-4 py-2.5 ${hasRisk ? "font-medium text-red-600" : "text-slate-500"}`} title={riskTitle}>
                      {r.details ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{r.paidLeave ? "Sim" : "Não"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Nome em <span className="font-medium text-red-600">vermelho</span> = folga compensada cujo cruzamento com o
        ponto real do motorista aponta risco trabalhista (sem hora extra que a justifique, hora extra do dia acima
        de 2h que deveria ter sido paga em vez de compensada, ou compensação fora da mesma semana sem confirmação de
        acordo de banco de horas). Passe o mouse sobre o nome para ver o motivo. Não é aconselhamento jurídico —
        atestado e abono não têm checagem automática aqui; férias em dobro (acima) só é calculado para motoristas com
        data de admissão cadastrada.
      </p>
    </div>
  );
}
