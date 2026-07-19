import Link from "next/link";
import { Pencil } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { toggleSindicatoActive } from "./actions";

export default async function SindicatosPage() {
  const session = await requireSession();

  const sindicatos = await prisma.sindicato.findMany({
    where: { companyId: session.companyId },
    include: { _count: { select: { drivers: true } } },
    orderBy: { nome: "asc" },
  });

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Sindicatos"
        subtitle="Vínculo sindical dos motoristas — base para o motor de conformidade de convenção coletiva."
        actionHref="/cadastros/sindicatos/novo"
        actionLabel="Novo sindicato"
      />

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Cidade/UF</th>
                <th className="px-4 py-3">Motoristas</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sindicatos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Nenhum sindicato cadastrado ainda.
                  </td>
                </tr>
              )}
              {sindicatos.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-800">{s.nome}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {s.cidade ? `${s.cidade}${s.estado ? `/${s.estado}` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s._count.drivers}</td>
                  <td className="px-4 py-3">
                    <form
                      action={toggleSindicatoActive.bind(null, s.id, !s.active)}
                    >
                      <button
                        type="submit"
                        className={`${badgeClass} ${
                          s.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {s.active ? "Ativo" : "Inativo"}
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/cadastros/sindicatos/${s.id}`}
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
