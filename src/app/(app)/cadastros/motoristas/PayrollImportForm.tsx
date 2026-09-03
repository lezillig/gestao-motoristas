"use client";

import { useActionState } from "react";
import { AlertTriangle, CheckCircle2, Search, Upload } from "lucide-react";
import { labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import {
  importDriversFromPayrollFile,
  previewPayrollSindicatos,
  type PayrollImportState,
  type PreviewSindicatosState,
} from "./actions";

const STATUS_LABEL = {
  encontrado: { label: "Encontrado", tone: "text-emerald-700" },
  sugestao: { label: "Sugestão", tone: "text-amber-700" },
  sem_correspondencia: { label: "Sem correspondência", tone: "text-red-700" },
};

export default function PayrollImportForm() {
  const [state, formAction, pending] = useActionState<PayrollImportState, FormData>(
    importDriversFromPayrollFile,
    {}
  );
  const [previewState, previewAction, previewPending] = useActionState<PreviewSindicatosState, FormData>(
    previewPayrollSindicatos,
    {}
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <div>
          <label className={labelClass}>Empregador (razão social)</label>
          <input
            type="text"
            name="empregador"
            required
            placeholder="Ex.: AZUL TRANSPORTES E TURISMO LTDA"
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-400">
            O arquivo não traz essa informação — cada exportação é de uma única empresa. Não precisa
            preencher isso só pra usar o &quot;Ver sindicatos da planilha&quot; abaixo.
          </p>
        </div>

        <div>
          <label className={labelClass}>Arquivo (.xls ou .xlsx)</label>
          <input
            type="file"
            name="arquivo"
            accept=".xls,.xlsx"
            required
            className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-700 file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-white file:hover:bg-blue-800"
          />
        </div>

        {state.error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.error}</span>
          </div>
        )}
        {previewState.error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{previewState.error}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={pending} className={`${primaryButtonClass} inline-flex items-center gap-2`}>
            <Upload className="h-4 w-4" /> {pending ? "Importando..." : "Importar"}
          </button>
          <button
            type="submit"
            formAction={previewAction}
            disabled={previewPending}
            className={`${secondaryButtonClass} inline-flex items-center gap-2`}
          >
            <Search className="h-4 w-4" /> {previewPending ? "Analisando..." : "Ver sindicatos da planilha"}
          </button>
        </div>
      </form>

      {previewState.result && (
        <div className="border-t border-slate-200 pt-4">
          <p className="mb-2 text-sm font-medium text-slate-700">
            {previewState.result.divergencias.length} sindicato(s) distinto(s) na planilha:
          </p>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-3 py-2">Texto na planilha</th>
                  <th className="px-3 py-2 text-right">Motoristas</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Cadastrado como</th>
                </tr>
              </thead>
              <tbody>
                {previewState.result.divergencias.map((d, i) => {
                  const status = STATUS_LABEL[d.status];
                  return (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="max-w-[220px] px-3 py-2 text-slate-700">{d.textoNaPlanilha}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{d.qtd}</td>
                      <td className={`px-3 py-2 font-medium ${status.tone}`}>{status.label}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {d.sindicatoEncontrado ??
                          (d.sugestao ? `${d.sugestao.nome} (${Math.round(d.sugestao.score * 100)}% parecido)` : "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            &quot;Encontrado&quot; casa automático na importação. &quot;Sugestão&quot; é só palpite por
            palavras parecidas — não é usado automático, cadastre o sindicato com esse nome (ou um alias)
            antes de importar se quiser que ligue sozinho. &quot;Sem correspondência&quot; não achou nada
            parecido no cadastro.
          </p>
        </div>
      )}

      {state.result && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {state.result.created} colaborador(es) novo(s) importado(s), {state.result.updated} já
              cadastrado(s) atualizado(s) (empregador/unidade de alocação/função).
            </span>
          </div>
          {state.result.sindicatoNaoEncontrado > 0 && (
            <p className="text-sm text-amber-700">
              {state.result.sindicatoNaoEncontrado} linha(s) com sindicato não encontrado no cadastro —
              motorista foi criado mesmo assim, sem sindicato vinculado.
            </p>
          )}
          {state.result.errors.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-red-700">
                {state.result.errors.length} linha(s) não importada(s):
              </p>
              <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-red-600">
                {state.result.errors.map((e, i) => (
                  <li key={i}>
                    Linha {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
