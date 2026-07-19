import Link from "next/link";
import { format } from "date-fns";
import { FileText } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { isVigente } from "@/lib/convencao";

export default async function ConvencoesPage() {
  const session = await requireSession();

  const convencoes = await prisma.convencaoColetiva.findMany({
    where: { companyId: session.companyId },
    include: { sindicato: true, _count: { select: { regras: true } } },
    orderBy: { vigenciaInicio: "desc" },
  });

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Convenção coletiva"
        subtitle="CCT por sindicato, usada para checar automaticamente o ponto dos motoristas."
        actionHref="/convencoes/novo"
        actionLabel="Nova convenção"
      />

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Sindicato</th>
                <th className="px-4 py-3">Vigência</th>
                <th className="px-4 py-3">Regras</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {convencoes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma convenção coletiva cadastrada ainda.
                  </td>
                </tr>
              )}
              {convencoes.map((c) => {
                const vigente = isVigente(c);
                return (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{c.sindicato.nome}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {format(c.vigenciaInicio, "dd/MM/yyyy")} –{" "}
                      {c.vigenciaFim ? format(c.vigenciaFim, "dd/MM/yyyy") : "indeterminado"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c._count.regras}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`${badgeClass} ${
                          vigente ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {vigente ? "Vigente" : "Expirada"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/convencoes/${c.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" /> Ver
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
