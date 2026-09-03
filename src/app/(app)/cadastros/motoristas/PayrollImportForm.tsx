"use client";

import { useActionState } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { labelClass, primaryButtonClass } from "@/lib/ui";
import { importDriversFromPayrollFile, type PayrollImportState } from "./actions";

export default function PayrollImportForm() {
  const [state, formAction, pending] = useActionState<PayrollImportState, FormData>(
    importDriversFromPayrollFile,
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
            O arquivo não traz essa informação — cada exportação é de uma única empresa.
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

        <button type="submit" disabled={pending} className={`${primaryButtonClass} inline-flex items-center gap-2`}>
          <Upload className="h-4 w-4" /> {pending ? "Importando..." : "Importar"}
        </button>
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
