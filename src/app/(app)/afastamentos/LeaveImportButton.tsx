"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { primaryButtonClass } from "@/lib/ui";
import { prepareLeaveImport, importLeavesForDriver, type LeaveImportRowError } from "./actions";

type Progress = { done: number; total: number; currentDriverName?: string };

export default function LeaveImportButton() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; errors: LeaveImportRowError[] } | null>(null);

  async function handleClick() {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);

    // Mesmo padrao de plano-depois-chamada-curta-por-motorista ja usado na
    // importacao de ponto — evita timeout de funcao serverless com
    // centenas de motoristas.
    const planResult = await prepareLeaveImport();
    if (planResult.error || !planResult.plan) {
      setError(planResult.error ?? "Falha ao preparar a importação.");
      setRunning(false);
      return;
    }

    const plan = planResult.plan;
    let imported = 0;
    const errors: LeaveImportRowError[] = [];

    for (let i = 0; i < plan.length; i++) {
      const item = plan[i];
      setProgress({ done: i, total: plan.length, currentDriverName: item.driverName });

      if (!item.employeeId) {
        errors.push({ driverName: item.driverName, message: "Nenhum funcionário com este CPF encontrado no TiqueTaque." });
        continue;
      }

      const driverResult = await importLeavesForDriver(item.driverId, item.employeeId);
      imported += driverResult.imported;
      errors.push(...driverResult.errors);
    }

    setProgress({ done: plan.length, total: plan.length });
    setResult({ imported, errors });
    setRunning(false);
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={handleClick} disabled={running} className={primaryButtonClass}>
        {running ? "Importando..." : "Importar folgas, atestados e férias do TiqueTaque"}
      </button>
      <p className="text-xs text-slate-400">
        Busca o histórico completo de cada motorista com CPF correspondente no TiqueTaque e
        atualiza os registros já existentes (mesmo id do TiqueTaque) — não duplica.
      </p>

      {progress && progress.total > 0 && (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-700 transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {progress.done < progress.total
              ? `Importando motorista ${progress.done + 1} de ${progress.total}${
                  progress.currentDriverName ? ` (${progress.currentDriverName})` : ""
                }…`
              : `${progress.total} motorista(s) processado(s).`}
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{result.imported} registro(s) de afastamento/folga/férias importado(s) ou atualizado(s).</span>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-red-700">
                {result.errors.length} ocorrência(s) não importada(s):
              </p>
              <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-red-600">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    {e.driverName}: {e.message}
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
