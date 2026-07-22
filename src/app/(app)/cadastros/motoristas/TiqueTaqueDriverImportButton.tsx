"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { primaryButtonClass } from "@/lib/ui";
import { importDriversFromTiqueTaque, type TiqueTaqueDriverImportState } from "./actions";

export default function TiqueTaqueDriverImportButton() {
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<TiqueTaqueDriverImportState | null>(null);

  async function handleClick() {
    setRunning(true);
    setState(null);
    const result = await importDriversFromTiqueTaque();
    setState(result);
    setRunning(false);
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={handleClick} disabled={running} className={primaryButtonClass}>
        {running ? "Importando..." : "Importar motoristas ativos do TiqueTaque"}
      </button>
      <p className="text-xs text-slate-400">
        Traz nome, CPF, telefone e valor-hora dos funcionários ativos com cargo de motorista. CNH não vem do
        TiqueTaque — os importados aparecem como "CNH pendente" até serem completados.
      </p>

      {state?.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {state?.result && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.result.created} motorista(s) importado(s) com sucesso.</span>
          </div>
          {state.result.errors.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-red-700">
                {state.result.errors.length} ocorrência(s) não importada(s):
              </p>
              <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-red-600">
                {state.result.errors.map((e, i) => (
                  <li key={i}>
                    {e.name} ({e.cpf}): {e.message}
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
