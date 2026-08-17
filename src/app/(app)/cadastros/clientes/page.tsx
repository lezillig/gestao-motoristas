import Link from "next/link";
import { Pencil } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import { toggleClienteActive } from "./actions";
import type { Prisma } from "@prisma/client";

const SORT_FIELDS = ["nome", "motoristas"] as const;
type SortField = (typeof SORT_FIELDS)[number];

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { sort, dir } = await searchParams;

  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "nome";
  const sortDir = dir === "desc" ? "desc" : "asc";
  const orderBy: Prisma.ClienteOrderByWithRelationInput =
    sortField === "motoristas" ? { drivers: { _count: sortDir } } : { nome: sortDir };

  const clientes = await prisma.cliente.findMany({
    where: { companyId: session.companyId },
    include: { _count: { select: { drivers: true } } },
    orderBy,
  });

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Clientes"
        subtitle="Cliente/centro de custo de cada motorista ou funcionário — base para análise de custo por contrato."
        actionHref="/cadastros/clientes/novo"
        actionLabel="Novo cliente"
        secondaryActionHref="/cadastros/clientes/importar"
        secondaryActionLabel="Importar centro de custo"
      />

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <SortableTh label="Nome" field="nome" basePath="/cadastros/clientes" currentParams={{}} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <th className="px-4 py-3">Janela contratada</th>
                <SortableTh label="Motoristas/funcionários" field="motoristas" basePath="/cadastros/clientes" currentParams={{}} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {clientes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Nenhum cliente cadastrado ainda.
                  </td>
                </tr>
              )}
              {clientes.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-800">{c.nome}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {c.horarioInicioContratado && c.horarioFimContratado
                      ? `${c.horarioInicioContratado}–${c.horarioFimContratado}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c._count.drivers}</td>
                  <td className="px-4 py-3">
                    <form action={toggleClienteActive.bind(null, c.id, !c.active)}>
                      <button
                        type="submit"
                        className={`${badgeClass} ${
                          c.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {c.active ? "Ativo" : "Inativo"}
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/cadastros/clientes/${c.id}`}
                      prefetch={false}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Link>
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
