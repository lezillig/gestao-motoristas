"use client";

import { useActionState } from "react";
import { AlertTriangle } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { importFromTiqueTaque, type TiqueTaqueImportState } from "./actions";

const initialState: TiqueTaqueImportState = {};

export default function TiqueTaqueImportForm() {
  const [state, formAction, pending] = useActionState<TiqueTaqueImportState, FormData>(
    importFromTiqueTaque,
    initialState
  );

  return (
    <div className="space-y-6">
      <form action={formAction} className="flex flex-wrap items-end gap-4">
        <div>
          <label className={labelClass}>Data inicial *</label>
          <input type="date" name="startDate" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Data final *</label>
          <input type="date" name="endDate" required className={inputClass} />
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Importando..." : "Importar"}
        </button>
      </form>

      {state.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {state.result && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          {state.result.created > 0 && (
            <p className="text-sm font-medium text-emerald-700">
              {state.result.created} registro(s) de ponto importado(s) com sucesso.
            </p>
          )}
          {state.result.errors.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-red-700">
                {state.result.errors.length} ocorrência(s) não importada(s):
              </p>
              <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-red-600">
                {state.result.errors.map((e, i) => (
                  <li key={i}>
                    {e.driverName}
                    {e.date ? ` (${e.date})` : ""}: {e.message}
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
