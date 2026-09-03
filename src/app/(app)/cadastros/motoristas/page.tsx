import Link from "next/link";
import { format } from "date-fns";
import { Pencil, Search } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import ComboboxFilter from "@/components/ui/ComboboxFilter";
import { toArray } from "@/lib/searchParams";
import MergeFieldForm from "./MergeFieldForm";
import { cnhAlertLevel, daysUntil } from "@/lib/driverAlerts";
import { toggleDriverActive } from "./actions";
import type { Prisma } from "@prisma/client";

const SORT_FIELDS = [
  "name",
  "cpf",
  "sindicato",
  "cnhExpiration",
  "empregador",
  "departamento",
  "funcao",
  "regimeHoras",
  "escalaSemanal",
] as const;
type SortField = (typeof SORT_FIELDS)[number];

export default async function MotoristasPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    sindicatoId?: string | string[];
    status?: string;
    empregador?: string | string[];
    departamento?: string | string[];
    cargo?: string | string[];
    regime?: string;
    escala?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { q, status, regime, escala, sort, dir, ...rawFilters } = await searchParams;
  const sindicatoId = toArray(rawFilters.sindicatoId);
  const empregador = toArray(rawFilters.empregador);
  const departamento = toArray(rawFilters.departamento);
  const cargo = toArray(rawFilters.cargo);

  const where: Prisma.DriverWhereInput = { companyId: session.companyId };
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { cpf: { contains: q } },
    ];
  }
  if (sindicatoId.length > 0) where.sindicatoId = { in: sindicatoId };
  if (status === "ativo") where.active = true;
  if (status === "inativo") where.active = false;
  if (empregador.length > 0) where.empregador = { in: empregador };
  if (departamento.length > 0) where.departamento = { in: departamento };
  if (cargo.length > 0) where.funcao = { in: cargo };
  if (regime === "PADRAO" || regime === "DOZE_X_TRINTA_SEIS") where.regimeHoras = regime;
  if (escala === "SEIS_UM" || escala === "CINCO_DOIS") where.escalaSemanal = escala;

  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "name";
  const sortDir = dir === "desc" ? "desc" : "asc";
  const orderBy: Prisma.DriverOrderByWithRelationInput =
    sortField === "sindicato"
      ? { sindicato: { nome: sortDir } }
      : sortField === "cnhExpiration"
          ? { cnhExpiration: { sort: sortDir, nulls: "last" } }
          : sortField === "cpf"
            ? { cpf: sortDir }
            : sortField === "empregador"
              ? { empregador: { sort: sortDir, nulls: "last" } }
              : sortField === "departamento"
                ? { departamento: { sort: sortDir, nulls: "last" } }
                : sortField === "funcao"
                  ? { funcao: { sort: sortDir, nulls: "last" } }
                  : sortField === "regimeHoras"
                    ? { regimeHoras: { sort: sortDir, nulls: "last" } }
                    : sortField === "escalaSemanal"
                      ? { escalaSemanal: { sort: sortDir, nulls: "last" } }
                      : { name: sortDir };

  const sortLinkParams = { q, sindicatoId, status, empregador, departamento, cargo, regime, escala };

  const [drivers, sindicatos, empregadorRows, departamentoRows, cargoRows] = await Promise.all([
    prisma.driver.findMany({
      where,
      include: { sindicato: true },
      orderBy,
    }),
    prisma.sindicato.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { nome: "asc" },
    }),
    prisma.driver.findMany({
      where: { companyId: session.companyId, empregador: { not: null } },
      select: { empregador: true },
      distinct: ["empregador"],
      orderBy: { empregador: "asc" },
    }),
    prisma.driver.findMany({
      where: { companyId: session.companyId, departamento: { not: null } },
      select: { departamento: true },
      distinct: ["departamento"],
      orderBy: { departamento: "asc" },
    }),
    prisma.driver.findMany({
      where: { companyId: session.companyId, funcao: { not: null } },
      select: { funcao: true },
      distinct: ["funcao"],
      orderBy: { funcao: "asc" },
    }),
  ]);
  const empregadores = empregadorRows.map((r) => r.empregador!).sort((a, b) => a.localeCompare(b));
  const departamentos = departamentoRows.map((r) => r.departamento!).sort((a, b) => a.localeCompare(b));
  const cargos = cargoRows.map((r) => r.funcao!).sort((a, b) => a.localeCompare(b));

  return (
    <div className="max-w-full">
      <PageHeader
        title="Motoristas"
        subtitle="Cadastro base do motorista, com vínculo sindical para o motor de conformidade."
        actionHref="/cadastros/motoristas/novo"
        actionLabel="Novo motorista"
        secondaryActionHref="/cadastros/motoristas/importar"
        secondaryActionLabel="Importar planilha"
      />

      <MergeFieldForm empregadores={empregadores} departamentos={departamentos} cargos={cargos} sindicatos={sindicatos} />

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600">Buscar</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Nome ou CPF"
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>
        <div className="w-48">
          <ComboboxFilter
            multiple
            name="sindicatoId"
            label="Sindicato"
            defaultValue={sindicatoId}
            options={sindicatos.map((s) => ({ value: s.id, label: s.nome }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
          <select name="status" defaultValue={status ?? ""} className={inputClass}>
            <option value="">Todos</option>
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
          </select>
        </div>
        <div className="w-56">
          <ComboboxFilter
            multiple
            name="empregador"
            label="Empregador"
            defaultValue={empregador}
            options={empregadores.map((e) => ({ value: e, label: e }))}
          />
        </div>
        <div className="w-56">
          <ComboboxFilter
            multiple
            name="departamento"
            label="Unidade de alocação"
            defaultValue={departamento}
            options={departamentos.map((d) => ({ value: d, label: d }))}
          />
        </div>
        <div className="w-56">
          <ComboboxFilter
            multiple
            name="cargo"
            label="Cargo"
            defaultValue={cargo}
            options={cargos.map((c) => ({ value: c, label: c }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Regime</label>
          <select name="regime" defaultValue={regime ?? ""} className={inputClass}>
            <option value="">Todos</option>
            <option value="PADRAO">Padrão</option>
            <option value="DOZE_X_TRINTA_SEIS">12x36</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Escala</label>
          <select name="escala" defaultValue={escala ?? ""} className={inputClass}>
            <option value="">Todas</option>
            <option value="SEIS_UM">6x1</option>
            <option value="CINCO_DOIS">5x2</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
      </form>

      <p className="mb-3 text-sm text-slate-500">
        {drivers.length} motorista{drivers.length === 1 ? "" : "s"} encontrado{drivers.length === 1 ? "" : "s"}
        {q || sindicatoId.length > 0 || status || empregador.length > 0 || departamento.length > 0 || cargo.length > 0 || regime || escala
          ? " com os filtros aplicados"
          : ""}
        .
      </p>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <SortableTh label="Unidade de alocação" field="departamento" basePath="/cadastros/motoristas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-3 py-2" />
                <SortableTh label="Cargo" field="funcao" basePath="/cadastros/motoristas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-3 py-2" />
                <SortableTh label="Nome" field="name" basePath="/cadastros/motoristas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-3 py-2" />
                <SortableTh label="Sindicato" field="sindicato" basePath="/cadastros/motoristas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-3 py-2" />
                <SortableTh label="CPF" field="cpf" basePath="/cadastros/motoristas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-3 py-2" />
                <SortableTh label="CNH" field="cnhExpiration" basePath="/cadastros/motoristas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-3 py-2" />
                <th className="whitespace-nowrap px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {drivers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    Nenhum motorista encontrado.
                  </td>
                </tr>
              )}
              {drivers.map((d) => {
                const level = cnhAlertLevel(d.cnhExpiration, d.funcao);
                const days = d.cnhExpiration ? daysUntil(d.cnhExpiration) : null;
                return (
                  <tr key={d.id} className="border-b border-slate-100 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{d.departamento ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{d.funcao ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{d.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{d.sindicato?.nome ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{d.cpf}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-center gap-2">
                        {level === "nao_aplicavel" ? (
                          <span className="text-slate-400" title="Cargo não exige CNH">
                            —
                          </span>
                        ) : level === "pendente" ? (
                          <span className={`${badgeClass} bg-slate-100 text-slate-600`}>CNH pendente</span>
                        ) : (
                          <>
                            <span className="text-slate-600">
                              {d.cnhCategory} · {format(d.cnhExpiration!, "dd/MM/yyyy")}
                            </span>
                            {level !== "ok" && (
                              <span
                                className={`${badgeClass} ${
                                  level === "vencida"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {level === "vencida" ? `Vencida há ${Math.abs(days!)}d` : `${days}d`}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <form action={toggleDriverActive.bind(null, d.id, !d.active)}>
                        <button
                          type="submit"
                          className={`${badgeClass} ${
                            d.active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {d.active ? "Ativo" : "Inativo"}
                        </button>
                      </form>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Link
                        href={`/cadastros/motoristas/${d.id}`}
                        prefetch={false}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
