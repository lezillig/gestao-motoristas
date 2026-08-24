import Link from "next/link";
import { Pencil, Search } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import DeleteVehicleButton from "./DeleteVehicleButton";
import { deleteVehicle } from "./actions";
import type { Prisma } from "@prisma/client";

const STATUS_LABEL: Record<string, string> = {
  ATIVO: "Ativo",
  MANUTENCAO: "Em manutenção",
  INATIVO: "Inativo",
};

const STATUS_TONE: Record<string, string> = {
  ATIVO: "bg-emerald-100 text-emerald-700",
  MANUTENCAO: "bg-amber-100 text-amber-700",
  INATIVO: "bg-slate-100 text-slate-500",
};

const SORT_FIELDS = ["plate", "brand", "year", "currentMileage", "status"] as const;
type SortField = (typeof SORT_FIELDS)[number];

export default async function VeiculosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; status?: string; sort?: string; dir?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { q, type, status, sort, dir } = await searchParams;

  const where: Prisma.VehicleWhereInput = { companyId: session.companyId };
  if (q) {
    where.OR = [
      { plate: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { model: { contains: q, mode: "insensitive" } },
    ];
  }
  if (type) where.type = type;
  // Por padrao (sem filtro escolhido ainda) mostra so os ativos — a frota
  // tem veiculo inativo/baixado que so deveria aparecer quando pedido.
  if (status !== "todos") where.status = { not: "INATIVO" };

  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "plate";
  const sortDir = dir === "desc" ? "desc" : "asc";
  const orderBy: Prisma.VehicleOrderByWithRelationInput = { [sortField]: sortDir };

  const sortLinkParams = { q, type, status };

  const [vehicles, typeRows] = await Promise.all([
    prisma.vehicle.findMany({ where, orderBy }),
    prisma.vehicle.findMany({
      where: { companyId: session.companyId },
      select: { type: true },
      distinct: ["type"],
      orderBy: { type: "asc" },
    }),
  ]);
  const types = typeRows.map((r) => r.type);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Veículos"
        subtitle="Frota disponível para vínculo nas escalas."
        actionHref="/cadastros/veiculos/novo"
        actionLabel="Novo veículo"
        secondaryActionHref="/cadastros/veiculos/importar"
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
              placeholder="Placa, marca ou modelo"
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tipo</label>
          <select name="type" defaultValue={type ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Mostrar</label>
          <select name="status" defaultValue={status === "todos" ? "todos" : ""} className={inputClass}>
            <option value="">Ativos</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
      </form>

      <p className="mb-3 text-sm text-slate-500">
        {vehicles.length} veículo{vehicles.length === 1 ? "" : "s"}
        {status === "todos" ? "" : " ativo" + (vehicles.length === 1 ? "" : "s")} encontrado
        {vehicles.length === 1 ? "" : "s"}
        {q || type ? " com os filtros aplicados" : ""}.
      </p>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <SortableTh label="Placa" field="plate" basePath="/cadastros/veiculos" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Veículo" field="brand" basePath="/cadastros/veiculos" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <th className="px-4 py-3">Tipo</th>
                <SortableTh label="Ano" field="year" basePath="/cadastros/veiculos" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Km atual" field="currentMileage" basePath="/cadastros/veiculos" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Status" field="status" basePath="/cadastros/veiculos" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <th className="px-4 py-3" />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {vehicles.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {q || type || status === "todos" ? "Nenhum veículo encontrado com os filtros aplicados." : "Nenhum veículo ativo cadastrado ainda."}
                  </td>
                </tr>
              )}
              {vehicles.map((v) => (
                <tr key={v.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800">{v.plate}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {v.brand} {v.model}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{v.type}</td>
                  <td className="px-4 py-3 text-slate-600">{v.year ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{v.currentMileage.toLocaleString("pt-BR")} km</td>
                  <td className="px-4 py-3">
                    <span className={`${badgeClass} ${STATUS_TONE[v.status]}`}>
                      {STATUS_LABEL[v.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/cadastros/veiculos/${v.id}`}
                      prefetch={false}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DeleteVehicleButton action={deleteVehicle.bind(null, v.id)} plate={v.plate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
