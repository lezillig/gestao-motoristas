import { format } from "date-fns";
import Link from "next/link";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, secondaryButtonClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import CheckboxDropdownFilter from "@/components/ui/CheckboxDropdownFilter";
import { toArray } from "@/lib/searchParams";
import { isLwAvailable } from "@/lib/lw/client";
import {
  MULTA_SORT_FIELDS,
  MULTAS_PAGE_SIZE,
  INDICACAO_STATUS_OPTIONS,
  fetchMultasList,
  fetchMultasCount,
  fetchMultasFilterOptions,
  fetchPrazoAlertCounts,
  fetchEscalasDoDiaPorMultas,
  fetchIturanCruzamentoPorMultas,
  type MultaSortField,
  type MultasFilters,
  type EscalaDoDia,
  type IturanCruzamento,
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
    page?: string;
  }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const available = isLwAvailable();
  const { sort, dir, page: pageParam, ...rawFilters } = await searchParams;

  const filters: MultasFilters = {
    situacaoLw: toArray(rawFilters.situacaoLw),
    indicacaoStatus: toArray(rawFilters.indicacaoStatus),
    vehicleId: toArray(rawFilters.vehicleId),
    driverId: toArray(rawFilters.driverId),
  };
  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "dataInfracao";
  const sortDir = dir === "asc" ? "asc" : "desc";
  const sortLinkParams = { ...filters, sort: sortField, dir: sortDir };
  const page = Math.max(1, Number(pageParam) || 1);

  // "Vencendo" e "vencido" sao situacoes diferentes — muita multa aqui e
  // historico antigo (2024/2025) com prazo ja passado ha muito tempo, entao
  // um filtro so "dias <= 5" (sem exigir dias >= 0) conta esses casos
  // vencidos ha meses junto com os que realmente vencem em breve, inflando
  // o numero (bug real confirmado 2026-09-09: 532 de 561 multas apareciam
  // como "vencendo" so por causa disso). Contado direto no banco (nao sobre
  // `multas` abaixo, que agora e so 1 pagina) — o aviso e sobre a empresa
  // inteira, nao so sobre o que esta visivel na tela.
  const agora = new Date();

  const [multas, totalMultas, filterOptions, drivers, prazoAlertas] = await Promise.all([
    available ? fetchMultasList(session.companyId, filters, sortField, sortDir, page) : Promise.resolve([]),
    available ? fetchMultasCount(session.companyId, filters) : Promise.resolve(0),
    available ? fetchMultasFilterOptions(session.companyId) : Promise.resolve({ situacoes: [], veiculos: [], condutores: [] }),
    available
      ? prisma.driver.findMany({
          where: { companyId: session.companyId, active: true },
          select: { id: true, name: true, cpf: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    available ? fetchPrazoAlertCounts(session.companyId, agora) : Promise.resolve({ vencido: 0, vencendoEm5Dias: 0 }),
  ]);

  const totalPaginas = Math.max(1, Math.ceil(totalMultas / MULTAS_PAGE_SIZE));
  const escalasPorMulta: Map<string, EscalaDoDia[]> = available
    ? await fetchEscalasDoDiaPorMultas(session.companyId, multas)
    : new Map();
  const iturarPorMulta: Map<string, IturanCruzamento> = available
    ? await fetchIturanCruzamentoPorMultas(session.companyId, multas)
    : new Map();

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

      {prazoAlertas.vencido > 0 && (
        <div className={`${cardClass} mb-3 flex items-start gap-3 border-red-200 bg-red-50`}>
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm text-red-800">
            {prazoAlertas.vencido} multa(s) com prazo de indicação de condutor já vencido, sem indicação enviada.
          </p>
        </div>
      )}

      {prazoAlertas.vencendoEm5Dias > 0 && (
        <div className={`${cardClass} mb-6 flex items-start gap-3 border-amber-200 bg-amber-50`}>
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            {prazoAlertas.vencendoEm5Dias} multa(s) com prazo de indicação de condutor vencendo nos próximos 5 dias.
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
          {totalMultas} multa{totalMultas === 1 ? "" : "s"} encontrada{totalMultas === 1 ? "" : "s"}
          {temFiltro ? " com os filtros aplicados" : ""}
          {totalPaginas > 1 ? ` — página ${page} de ${totalPaginas}` : ""}.
        </p>
      )}

      <div className={`${cardClass} overflow-x-auto p-0`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <SortableTh label="Placa" field="placa" basePath="/multas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-4 py-3" />
              <SortableTh label="Data" field="dataInfracao" basePath="/multas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-4 py-3" />
              <th className="whitespace-nowrap px-4 py-3">AIT</th>
              <SortableTh label="Valor" field="valorCents" basePath="/multas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-4 py-3" />
              <SortableTh label="Prazo indicação" field="dataLimiteIndicacao" basePath="/multas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-4 py-3" />
              <th className="whitespace-nowrap px-4 py-3">Escalado no SIAT</th>
              <th className="whitespace-nowrap px-4 py-3">Ituran (mais próximo)</th>
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
                <td className="px-4 py-3 text-slate-600">
                  <p className="whitespace-nowrap">
                    {m.ait ?? "—"}
                    <a
                      href={`/api/multas/${m.id}/imagem`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-[11px] font-medium text-blue-700 hover:underline"
                    >
                      Ver notificação
                    </a>
                  </p>
                  {typeof (m.rawJson as { endereco?: unknown } | null)?.endereco === "string" && (
                    <p className="max-w-[200px] text-[11px] text-slate-400">
                      {(m.rawJson as { endereco: string }).endereco}
                    </p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatBRL(m.valorCents)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {m.dataLimiteIndicacao ? format(m.dataLimiteIndicacao, "dd/MM/yyyy") : "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {(() => {
                    const escalas = m.vehicleId && m.dataInfracao
                      ? escalasPorMulta.get(`${m.vehicleId}|${m.dataInfracao.getTime()}`)
                      : undefined;
                    if (!escalas || escalas.length === 0) return "—";
                    return escalas.map((e, i) => (
                      <p key={i} className="whitespace-nowrap text-xs">
                        {e.driverName} ({e.startTime}
                        {e.endTime ? `–${e.endTime}` : ""})
                      </p>
                    ));
                  })()}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {(() => {
                    const cruzamento = iturarPorMulta.get(m.id);
                    if (!cruzamento || !cruzamento.enderecoViagem) return "—";
                    return (
                      <div className="max-w-[220px]">
                        <p className="text-xs">{cruzamento.enderecoViagem}</p>
                        <p className="text-[11px] text-slate-400">
                          {cruzamento.dentroDaViagem
                            ? "durante uma viagem"
                            : `${cruzamento.distanciaMinutos} min de diferença`}
                        </p>
                      </div>
                    );
                  })()}
                </td>
                <td className="px-4 py-3">
                  <IndicacaoCell multaId={m.id} indicacao={m.indicacao} drivers={drivers} />
                </td>
              </tr>
            ))}
            {multas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                  {!available ? "Integração não configurada." : temFiltro ? "Nenhuma multa encontrada com os filtros aplicados." : "Nenhuma multa sincronizada ainda."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {available && totalPaginas > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Página {page} de {totalPaginas}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildPageHref(sortLinkParams, page - 1)}
                className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}
              >
                Anterior
              </Link>
            )}
            {page < totalPaginas && (
              <Link
                href={buildPageHref(sortLinkParams, page + 1)}
                className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}
              >
                Próxima
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function buildPageHref(params: Record<string, string | string[] | undefined>, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) search.append(key, v);
    } else if (value) {
      search.set(key, value);
    }
  }
  search.set("page", String(page));
  return `/multas?${search.toString()}`;
}
