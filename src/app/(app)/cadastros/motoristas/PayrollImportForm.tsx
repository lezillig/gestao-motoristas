"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, Search, Upload } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import {
  importDriversFromPayrollFile,
  previewPayrollSindicatos,
  resolveSindicatosFromPayroll,
  type PayrollImportState,
  type PreviewSindicatosState,
  type ResolveSindicatosState,
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
  const [resolveState, resolveAction, resolvePending] = useActionState<ResolveSindicatosState, FormData>(
    resolveSindicatosFromPayroll,
    {}
  );
  // So pra decidir se mostra "Criar novo" ou "Já temos" por linha — quem
  // realmente conta na hora de salvar e o <select>/<input> nativos dentro
  // do <form> (lidos via FormData na server action, sem estado React).
  const [modoPorLinha, setModoPorLinha] = useState<Record<number, "novo" | "existente">>({});

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

      {previewState.result && (
        <div className="border-t border-slate-200 pt-4">
          <p className="mb-2 text-sm font-medium text-slate-700">
            {previewState.result.divergencias.length} sindicato(s) distinto(s) na planilha:
          </p>
          <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-3 py-2">Texto na planilha</th>
                  <th className="px-3 py-2 text-right">Motoristas</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Cadastrado como</th>
                  <th className="px-3 py-2">Vincular a</th>
                </tr>
              </thead>
              <tbody>
                {previewState.result.divergencias.map((d, i) => {
                  const status = STATUS_LABEL[d.status];
                  if (d.status === "encontrado") {
                    return (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="max-w-[220px] px-3 py-2 text-slate-700" title={d.textoNaPlanilha}>
                          {d.textoNaPlanilha}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">{d.qtd}</td>
                        <td className={`px-3 py-2 font-medium ${status.tone}`}>{status.label}</td>
                        <td className="px-3 py-2 text-slate-600">{d.sindicatoEncontrado}</td>
                        <td className="px-3 py-2 text-slate-400">já vinculado</td>
                      </tr>
                    );
                  }
                  const modo = modoPorLinha[i] ?? (d.sugestao ? "existente" : "novo");
                  return (
                    <tr key={i} className="border-b border-slate-100 last:border-0 align-top">
                      <td className="max-w-[220px] px-3 py-2 text-slate-700" title={d.textoNaPlanilha}>
                        {d.textoNaPlanilha}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{d.qtd}</td>
                      <td className={`px-3 py-2 font-medium ${status.tone}`}>{status.label}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {d.sugestao ? `${d.sugestao.nome} (${Math.round(d.sugestao.score * 100)}% parecido)` : "—"}
                      </td>
                      <td className="min-w-[240px] px-3 py-2">
                        <select
                          name={`resolucao_${i}`}
                          defaultValue={modo === "existente" ? (d.sugestao?.id ?? "__novo__") : "__novo__"}
                          onChange={(e) =>
                            setModoPorLinha((prev) => ({ ...prev, [i]: e.target.value === "__novo__" ? "novo" : "existente" }))
                          }
                          className={`${inputClass} mb-1.5 py-1.5 text-xs`}
                        >
                          <option value="__novo__">+ Criar sindicato novo</option>
                          {previewState.result!.sindicatosExistentes.map((s) => (
                            <option key={s.id} value={s.id}>
                              Já temos: {s.nome}
                            </option>
                          ))}
                        </select>
                        {modo === "novo" && (
                          <input
                            type="text"
                            name={`nomeNovo_${i}`}
                            defaultValue={d.nomeSugeridoNovo}
                            placeholder="Nome do sindicato novo"
                            className={`${inputClass} py-1.5 text-xs uppercase`}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            &quot;Encontrado&quot; já casa automático na importação. Pras outras linhas, escolha um
            sindicato que já temos cadastrado (De/Para) ou crie um novo com o nome ao lado — depois clique
            em &quot;Vincular sindicatos escolhidos&quot;. Só preenche motorista que ainda está sem
            sindicato, nunca troca um vínculo já existente.
          </p>
          {resolveState.error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{resolveState.error}</span>
            </div>
          )}
          {resolveState.result && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {resolveState.result.criados} sindicato(s) novo(s) criado(s), {resolveState.result.motoristasAtualizados}{" "}
                motorista(s) vinculado(s).
              </span>
            </div>
          )}
          <button
            type="submit"
            formAction={resolveAction}
            disabled={resolvePending}
            className={`${primaryButtonClass} mt-3 inline-flex items-center gap-2`}
          >
            <Link2 className="h-4 w-4" /> {resolvePending ? "Vinculando..." : "Vincular sindicatos escolhidos"}
          </button>
        </div>
      )}
      </form>

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
