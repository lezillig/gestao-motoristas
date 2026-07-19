"use client";

import { useActionState } from "react";
import { Download, Upload } from "lucide-react";
import { labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";

export type ImportRowError = { row: number; message: string };
export type ImportResult = { created: number; errors: ImportRowError[] };
export type ImportState = { error?: string; result?: ImportResult };

export default function ImportSpreadsheetForm({
  action,
  templateHref,
  entityLabel,
}: {
  action: (prevState: ImportState, formData: FormData) => Promise<ImportState>;
  templateHref: string;
  entityLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(action, {});

  return (
    <div className="space-y-6">
      <a
        href={templateHref}
        className={`${secondaryButtonClass} inline-flex items-center gap-2`}
      >
        <Download className="h-4 w-4" /> Baixar modelo de planilha
      </a>

      <form action={formAction} className="space-y-4">
        <div>
          <label className={labelClass}>Arquivo (.xlsx)</label>
          <input
            type="file"
            name="arquivo"
            accept=".xlsx"
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
        <div className="space-y-3 border-t border-slate-200 pt-4">
          {state.result.created > 0 && (
            <p className="text-sm font-medium text-emerald-700">
              {state.result.created} {entityLabel} importado(s) com sucesso.
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
