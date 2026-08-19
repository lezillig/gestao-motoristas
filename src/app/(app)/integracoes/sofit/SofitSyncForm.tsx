"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, PlugZap } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { SOFIT_ENTITIES, SOFIT_ENTITY_LABELS } from "@/lib/sofit/types";
import { sincronizarSofit, testarConexaoSofit, type SofitSyncState } from "./actions";

type ConnectionState = { ok: boolean; mensagem: string; amostraPlacas?: string[] } | null;

export default function SofitSyncForm({
  configurado,
  defaultStartDate,
  defaultEndDate,
}: {
  configurado: boolean;
  defaultStartDate: string;
  defaultEndDate: string;
}) {
  const [state, formAction, pending] = useActionState<SofitSyncState, FormData>(sincronizarSofit, {});
  const [connection, setConnection] = useState<ConnectionState>(null);
  const [testing, setTesting] = useState(false);

  async function handleTest() {
    setTesting(true);
    setConnection(null);
    try {
      setConnection(await testarConexaoSofit());
    } catch (e) {
      setConnection({ ok: false, mensagem: e instanceof Error ? e.message : "Falha ao testar a conexão." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={handleTest}
          disabled={!configurado || testing}
          className={`${secondaryButtonClass} inline-flex items-center gap-1.5 disabled:opacity-60`}
        >
          <PlugZap className="h-4 w-4" />
          {testing ? "Testando..." : "Testar conexão"}
        </button>
        {connection && (
          <div
            className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
              connection.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}
          >
            {connection.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>
              {connection.mensagem}
              {connection.amostraPlacas && connection.amostraPlacas.length > 0 && (
                <> Placas de amostra: {connection.amostraPlacas.join(", ")}.</>
              )}
            </span>
          </div>
        )}
      </div>

      <form action={formAction} className="space-y-4 border-t border-slate-200 pt-6">
        <fieldset disabled={!configurado || pending} className="space-y-4">
          <div>
            <span className={labelClass}>O que sincronizar</span>
            <div className="flex flex-wrap gap-4">
              {SOFIT_ENTITIES.map((entidade) => (
                <label key={entidade} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name={`entidade_${entidade}`}
                    defaultChecked
                    className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-100"
                  />
                  {SOFIT_ENTITY_LABELS[entidade]}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className={labelClass} htmlFor="startDate">
                Data inicial *
              </label>
              <input
                id="startDate"
                type="date"
                name="startDate"
                required
                defaultValue={defaultStartDate}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="endDate">
                Data final *
              </label>
              <input id="endDate" type="date" name="endDate" required defaultValue={defaultEndDate} className={inputClass} />
            </div>
            <button type="submit" className={primaryButtonClass}>
              {pending ? "Sincronizando..." : "Sincronizar agora"}
            </button>
          </div>
        </fieldset>

        <p className="flex items-start gap-1.5 text-xs text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          O período só se aplica a abastecimentos, manutenções e odômetro — o cadastro de veículos é sempre
          sincronizado por inteiro. Reexecutar o mesmo período não duplica nada.
        </p>
      </form>

      {state.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {state.results && state.results.length > 0 && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          {state.results.map((result) => (
            <div key={result.entidade} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium text-slate-800">{SOFIT_ENTITY_LABELS[result.entidade]}</p>
              <p className="mt-0.5 text-sm text-slate-600">
                {result.lidos} lido(s) · {result.criados} novo(s) · {result.atualizados} atualizado(s) ·{" "}
                {result.ignorados} sem alteração
              </p>
              {result.avisos.length > 0 && (
                <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-amber-700">
                  {result.avisos.map((aviso, i) => (
                    <li key={i}>{aviso}</li>
                  ))}
                </ul>
              )}
              {result.erros.length > 0 && (
                <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-red-600">
                  {result.erros.map((erro, i) => (
                    <li key={i}>{erro}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
