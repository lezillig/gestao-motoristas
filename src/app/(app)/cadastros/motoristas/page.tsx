import Link from "next/link";
import { format } from "date-fns";
import { Pencil, Search } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
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
    sindicatoId?: string;
    clienteId?: string;
    status?: string;
    empregador?: string;
    departamento?: string;
    cargo?: string;
    regime?: string;
    escala?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { q, sindicatoId, clienteId, status, empregador, departamento, cargo, regime, escala, sort, dir } =
    await searchParams;

  const where: Prisma.DriverWhereInput = { companyId: session.companyId };
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { cpf: { contains: q } },
    ];
  }
  if (sindicatoId) where.sindicatoId = sindicatoId;
  if (clienteId) where.clienteId = clienteId;
  if (status === "ativo") where.active = true;
  if (status === "inativo") where.active = false;
  if (empregador) where.empregador = empregador;
  if (departamento) where.departamento = departamento;
  if (cargo) where.funcao = cargo;
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

  const sortLinkParams = { q, sindicatoId, clienteId, status, empregador, departamento, cargo, regime, escala };

  const [drivers, sindicatos, clientes, empregadorRows, departamentoRows, cargoRows] = await Promise.all([
    prisma.driver.findMany({
      where,
      include: { sindicato: true },
      orderBy,
    }),
    prisma.sindicato.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { nome: "asc" },
    }),
    prisma.cliente.findMany({
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
    <div className="max-w-6xl">
      <PageHeader
        title="Motoristas"
        subtitle="Cadastro base do motorista, com vínculo sindical para o motor de conformidade."
        actionHref="/cadastros/motoristas/novo"
        actionLabel="Novo motorista"
        secondaryActionHref="/cadastros/motoristas/importar"
        secondaryActionLabel="Importar planilha"
      />

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
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Sindicato</label>
          <select name="sindicatoId" defaultValue={sindicatoId ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {sindicatos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Cliente</label>
          <select name="clienteId" defaultValue={clienteId ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
          <select name="status" defaultValue={status ?? ""} className={inputClass}>
            <option value="">Todos</option>
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Empregador</label>
          <select name="empregador" defaultValue={empregador ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {empregadores.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Unidade de alocação</label>
          <select name="departamento" defaultValue={departamento ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {departamentos.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Cargo</label>
          <select name="cargo" defaultValue={cargo ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {cargos.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
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
        {q || sindicatoId || clienteId || status || empregador || departamento || cargo || regime || escala ? " com os filtros aplicados" : ""}.
      </p>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <SortableTh label="Unidade de alocação" field="departamento" basePath="/cadastros/motoristas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-3 py-2" />
                <SortableTh label="Cargo" field="funcao" basePath="/cadastros/motoristas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-3 py-2" />
                <SortableTh label="Nome" field="name" basePath="/cadastros/motoristas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-3 py-2" />
                <SortableTh label="CPF" field="cpf" basePath="/cadastros/motoristas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-3 py-2" />
                <SortableTh label="CNH" field="cnhExpiration" basePath="/cadastros/motoristas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="whitespace-nowrap px-3 py-2" />
                <th className="whitespace-nowrap px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {drivers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
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
