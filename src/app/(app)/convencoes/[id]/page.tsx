import { notFound } from "next/navigation";
import { format } from "date-fns";
import { FileText, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass, badgeClass, secondaryButtonClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isVigente, TIPO_REGRA_LABELS, TIPO_REGRA_UNIDADE } from "@/lib/convencao";
import { isCctExtractionAvailable } from "@/lib/cctExtraction";
import RegraForm from "../RegraForm";
import AiSuggestionsPanel from "../AiSuggestionsPanel";
import { addRegra, addRegraPlain, deleteConvencao, removeRegra, suggestRegrasFromCct } from "../actions";

export default async function ConvencaoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const convencao = await prisma.convencaoColetiva.findUnique({
    where: { id, companyId: session.companyId },
    include: { sindicato: true, regras: { orderBy: { createdAt: "asc" } } },
  });
  if (!convencao) notFound();

  const vigente = isVigente(convencao);
  const addRegraAction = addRegra.bind(null, id);
  const removeConvencaoAction = deleteConvencao.bind(null, id);
  const suggestAction = suggestRegrasFromCct.bind(null, id);
  const addRegraPlainAction = addRegraPlain.bind(null, id);

  return (
    <div className="max-w-3xl">
      <PageHeader title={`Convenção — ${convencao.sindicato.nome}`} />

      <div className={`${cardClass} mb-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className={`${badgeClass} ${vigente ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {vigente ? "Vigente" : "Expirada"}
            </span>
            <p className="mt-2 text-sm text-slate-600">
              Vigência: {format(convencao.vigenciaInicio, "dd/MM/yyyy")} –{" "}
              {convencao.vigenciaFim ? format(convencao.vigenciaFim, "dd/MM/yyyy") : "indeterminado"}
            </p>
          </div>
          <a
            href={convencao.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-4 w-4" /> {convencao.fileName}
          </a>
        </div>
        <form action={removeConvencaoAction} className="mt-4 border-t border-slate-100 pt-4">
          <button type="submit" className={`${secondaryButtonClass} flex items-center gap-1.5 text-red-600 hover:bg-red-50`}>
            <Trash2 className="h-3.5 w-3.5" /> Remover convenção
          </button>
        </form>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-slate-900">Regras estruturadas</h2>

      {isCctExtractionAvailable() && (
        <AiSuggestionsPanel suggestAction={suggestAction} addSuggestedAction={addRegraPlainAction} />
      )}

      <div className={`${cardClass} mb-4 p-0 overflow-hidden`}>
        {convencao.regras.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">Nenhuma regra cadastrada ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Regra</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {convencao.regras.map((r) => {
                const removeAction = removeRegra.bind(null, id, r.id);
                return (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{TIPO_REGRA_LABELS[r.tipo]}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.valorNumerico !== null ? `${r.valorNumerico} ${TIPO_REGRA_UNIDADE[r.tipo]}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.descricao ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <form action={removeAction}>
                        <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
                          Remover
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <RegraForm action={addRegraAction} />
    </div>
  );
}
