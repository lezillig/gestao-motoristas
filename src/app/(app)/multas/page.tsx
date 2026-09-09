import { format } from "date-fns";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import CheckboxDropdownFilter from "@/components/ui/CheckboxDropdownFilter";
import { toArray } from "@/lib/searchParams";
import { isLwAvailable } from "@/lib/lw/client";
import {
  MULTA_SORT_FIELDS,
  INDICACAO_STATUS_OPTIONS,
  fetchMultasList,
  fetchMultasFilterOptions,
  type MultaSortField,
  type MultasFilters,
} from "@/lib/multasList";
import MultasSyncButton from "./MultasSyncButton";
import IndicacaoCell from "./IndicacaoCell";
import MultasExportBar from "./MultasExportBar";

const SORT_FIELDS: readonly MultaSortField[] = MULTA_SORT_FIELDS;
type SortField = MultaSortField;

function formatBRL(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const SITUACAO_BADGE: Record<string, string> = {
  IMPOSTO: "bg-amber-100 text-amber-800",
  NOTIFICADO: "bg-amber-100 text-amber-800",
  Encerrado: "bg-slate-100 text-slate-600",
  Cancelada: "bg-slate-100 text-slate-600",
  Devedora: "bg-red-100 text-red-700",
};

export default async function MultasPage({
  searchParams,
}: {
  searchParams: Promise<{
    situacaoLw?: string | string[];
    indicacaoStatus?: string | string[];
    vehicleId?: string | string[];
    driverId?: string | string[];
    sort?: string;
    dir?: string;
  }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const available = isLwAvailable();
  const { sort, dir, ...rawFilters } = await searchParams;

  const filters: MultasFilters = {
    situacaoLw: toArray(rawFilters.situacaoLw),
    indicacaoStatus: toArray(rawFilters.indicacaoStatus),
    vehicleId: toArray(rawFilters.vehicleId),
    driverId: toArray(rawFilters.driverId),
  };
  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "dataInfracao";
  const sortDir = dir === "asc" ? "asc" : "desc";
  const sortLinkParams = { ...filters, sort: sortField, dir: sortDir };

  const [multas, filterOptions, drivers] = await Promise.all([
    available ? fetchMultasList(session.companyId, filters, sortField, sortDir) : Promise.resolve([]),
    available ? fetchMultasFilterOptions(session.companyId) : Promise.resolve({ situacoes: [], veiculos: [], condutores: [] }),
    available
      ? prisma.driver.findMany({
          where: { companyId: session.companyId, active: true },
          select: { id: true, name: true, cpf: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const agora = new Date().getTime();
  const prazoVencendo = multas.filter((m) => {
    if (!m.dataLimiteIndicacao || m.indicacao?.status === "ENVIADA" || m.indicacao?.status === "VALIDADA") return false;
    const dias = (m.dataLimiteIndicacao.getTime() - agora) / 86_400_000;
    return dias <= 5;
  });

  const temFiltro =
    filters.situacaoLw.length > 0 || filters.indicacaoStatus.length > 0 || filters.vehicleId.length > 0 || filters.driverId.length > 0;

  return (
    <div className="max-w-full">
      <PageHeader
        title="Multas"
        subtitle="Multas de trânsito da frota (LW Tecnologia) e indicação do condutor responsável."
        extra={
          available ? (
            <div className="flex items-center gap-2">
              <MultasExportBar searchParams={{ ...filters, sort: sortField, dir: sortDir }} />
              <MultasSyncButton />
            </div>
          ) : undefined
        }
      />

      {!available && (
        <div className={`${cardClass} mb-6 flex items-start gap-3 border-amber-200 bg-amber-50`}>
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            Integração com a LW Tecnologia não configurada (LW_API_LOGIN/LW_API_SENHA). Configure as credenciais para
            sincronizar as multas da frota.
          </p>
        </div>
      )}

      {prazoVencendo.length > 0 && (
        <div className={`${cardClass} mb-6 flex items-start gap-3 border-red-200 bg-red-50`}>
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm text-red-800">
            {prazoVencendo.length} multa(s) com prazo de indicação de condutor vencendo em até 5 dias.
          </p>
        </div>
      )}

      {available && (
        <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
          <div className="w-56">
            <CheckboxDropdownFilter
              name="situacaoLw"
              label="Situação"
              allLabel="Todas"
              defaultValue={filters.situacaoLw}
              options={filterOptions.situacoes.map((s) => ({ value: s, label: s }))}
            />
          </div>
          <div className="w-64">
            <CheckboxDropdownFilter
              name="indicacaoStatus"
              label="Status da indicação"
              allLabel="Todos"
              defaultValue={filters.indicacaoStatus}
              options={INDICACAO_STATUS_OPTIONS}
            />
          </div>
          <div className="w-48">
            <CheckboxDropdownFilter
              name="vehicleId"
              label="Placa"
              allLabel="Todas"
              defaultValue={filters.vehicleId}
              options={filterOptions.veiculos.map((v) => ({ value: v.id, label: v.plate }))}
            />
          </div>
          <div className="w-56">
            <CheckboxDropdownFilter
              name="driverId"
              label="Condutor"
              allLabel="Todos"
              defaultValue={filters.driverId}
              options={filterOptions.condutores.map((d) => ({ value: d.id, label: d.name }))}
            />
          </div>
          <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Filtrar
          </button>
        </form>
      )}

      {available && (
        <p className="mb-3 text-sm text-slate-500">
          {multas.length} multa{multas.length === 1 ? "" : "s"} encontrada{multas.length === 1 ? "" : "s"}
          {temFiltro ? " com os filtros aplicados" : ""}.
        </p>
      )}

      <div className={`${cardClass} overflow-x-auto p-0`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <SortableTh label="Placa" field="placa" basePath="/multas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-4 py-3" />
              <SortableTh label="Data" field="dataInfracao" basePath="/multas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-4 py-3" />
              <th className="whitespace-nowrap px-4 py-3">AIT</th>
              <SortableTh label="Situação" field="situacaoLw" basePath="/multas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-4 py-3" />
              <SortableTh label="Valor" field="valorCents" basePath="/multas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-4 py-3" />
              <SortableTh label="Prazo indicação" field="dataLimiteIndicacao" basePath="/multas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-4 py-3" />
              <SortableTh label="Condutor" field="indicacaoStatus" basePath="/multas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {multas.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-700">
                  {m.vehicle?.plate ?? m.placaConsultada}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {m.dataInfracao ? format(m.dataInfracao, "dd/MM/yyyy") : "—"}
                  {m.horaInfracao ? ` ${m.horaInfracao}` : ""}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{m.ait ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className={`${badgeClass} ${SITUACAO_BADGE[m.situacaoLw ?? ""] ?? "bg-slate-100 text-slate-600"}`}>
                    {m.situacaoLw ?? "—"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatBRL(m.valorCents)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {m.dataLimiteIndicacao ? format(m.dataLimiteIndicacao, "dd/MM/yyyy") : "—"}
                </td>
                <td className="px-4 py-3">
                  <IndicacaoCell multaId={m.id} indicacao={m.indicacao} drivers={drivers} />
                </td>
              </tr>
            ))}
            {multas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                  {!available ? "Integração não configurada." : temFiltro ? "Nenhuma multa encontrada com os filtros aplicados." : "Nenhuma multa sincronizada ainda."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
