import Link from "next/link";
import { format } from "date-fns";
import { FileText, Info } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import { isVigente } from "@/lib/convencao";
import type { Prisma } from "@prisma/client";

const SORT_FIELDS = ["sindicato", "tipo", "vigenciaInicio"] as const;
type SortField = (typeof SORT_FIELDS)[number];

export default async function ConvencoesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string; prorrogada?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { sort, dir, prorrogada } = await searchParams;

  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "vigenciaInicio";
  // Direcao padrao (sem clique ainda) e desc, igual ao comportamento original desta pagina.
  const sortDir = dir === "asc" ? "asc" : "desc";
  const orderBy: Prisma.ConvencaoColetivaOrderByWithRelationInput =
    sortField === "sindicato"
      ? { sindicato: { nome: sortDir } }
      : sortField === "tipo"
        ? { tipo: sortDir }
        : { vigenciaInicio: sortDir };

  const convencoes = await prisma.convencaoColetiva.findMany({
    where: { companyId: session.companyId },
    include: { sindicato: true, _count: { select: { regras: true } } },
    orderBy,
  });

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Convenção coletiva"
        subtitle="CCT por sindicato, usada para checar automaticamente o ponto dos motoristas."
        actionHref="/convencoes/novo"
        actionLabel="Nova convenção"
      />

      {prorrogada === "1" && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            A vigência-fim da convenção anterior deste sindicato foi ajustada automaticamente para o dia anterior ao
            início da nova, evitando um período sem convenção vigente no cadastro. Isso reflete continuidade
            operacional — não é aplicação de ultratividade legal automática (encerrada pelo STF em 2022, ADPF 323);
            confirme se há acordo/aditivo respaldando essa continuidade.
          </span>
        </div>
      )}

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <SortableTh label="Sindicato" field="sindicato" basePath="/convencoes" currentParams={{}} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Tipo" field="tipo" basePath="/convencoes" currentParams={{}} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Vigência" field="vigenciaInicio" basePath="/convencoes" currentParams={{}} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <th className="px-4 py-3">Regras</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {convencoes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma convenção coletiva cadastrada ainda.
                  </td>
                </tr>
              )}
              {convencoes.map((c) => {
                const vigente = isVigente(c);
                const futura = !vigente && c.vigenciaInicio > new Date();
                return (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{c.sindicato.nome}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`${badgeClass} ${
                          c.tipo === "ACT" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {c.tipo === "ACT" ? "ACT" : "CCT"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {format(c.vigenciaInicio, "dd/MM/yyyy")} –{" "}
                      {c.vigenciaFim ? format(c.vigenciaFim, "dd/MM/yyyy") : "indeterminado"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c._count.regras}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`${badgeClass} ${
                          vigente
                            ? "bg-emerald-100 text-emerald-700"
                            : futura
                              ? "bg-blue-100 text-blue-700"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {vigente ? "Vigente" : futura ? "Ainda não vigente" : "Expirada"}
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
