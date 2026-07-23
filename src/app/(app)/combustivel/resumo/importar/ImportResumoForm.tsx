"use client";

import { useActionState } from "react";
import { Upload } from "lucide-react";
import { cardClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { importConsumptionSummary, type ImportResumoState } from "../actions";

export default function ImportResumoForm() {
  const [state, formAction, pending] = useActionState<ImportResumoState, FormData>(
    importConsumptionSummary,
    {}
  );

  return (
    <div className={cardClass}>
      <form action={formAction} className="space-y-4">
        <div>
          <label className={labelClass}>Arquivo do relatório (.xls)</label>
          <input
            type="file"
            name="arquivo"
            accept=".xls"
            required
            className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-700 file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-white file:hover:bg-blue-800"
          />
        </div>

        {state.error && <p className="text-sm text-red-600">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className={`${primaryButtonClass} inline-flex items-center gap-2`}
        >
          <Upload className="h-4 w-4" /> {pending ? "Importando..." : "Importar"}
        </button>
      </form>

      {state.result && (
        <div className="mt-4 space-y-1 border-t border-slate-200 pt-4 text-sm">
          <p className="font-medium text-emerald-700">
            {state.result.created} registro(s) importado(s) — período {state.result.periodo}.
          </p>
          {state.result.duplicated > 0 && (
            <p className="text-slate-500">
              {state.result.duplicated} registro(s) já haviam sido importados antes (ignorados).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
