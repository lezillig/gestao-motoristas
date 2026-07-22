"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import {
  prepareTiqueTaqueImport,
  importDriverFromTiqueTaque,
  type TiqueTaqueImportRowError,
} from "./actions";

type Progress = { done: number; total: number; currentDriverName?: string };

export default function TiqueTaqueImportForm() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; errors: TiqueTaqueImportRowError[] } | null>(null);

  async function handleSubmit(formData: FormData) {
    const startDate = String(formData.get("startDate") ?? "");
    const endDate = String(formData.get("endDate") ?? "");

    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);

    // Fase 1: monta o plano (uma chamada curta) antes de importar motorista
    // a motorista — cada chamada da fase 2 e curta o bastante pra nunca
    // esbarrar em timeout de funcao serverless, diferente da importacao
    // monolitica antiga que travava em periodos longos com varios motoristas.
    const planResult = await prepareTiqueTaqueImport(startDate, endDate);
    if (planResult.error || !planResult.plan) {
      setError(planResult.error ?? "Falha ao preparar a importação.");
      setRunning(false);
      return;
    }

    const plan = planResult.plan;
    let created = 0;
    const errors: TiqueTaqueImportRowError[] = [];

    for (let i = 0; i < plan.length; i++) {
      const item = plan[i];
      setProgress({ done: i, total: plan.length, currentDriverName: item.driverName });

      if (!item.employeeId) {
        errors.push({ driverName: item.driverName, message: "Nenhum funcionário com este CPF encontrado no TiqueTaque." });
        continue;
      }

      const driverResult = await importDriverFromTiqueTaque(item.driverId, item.employeeId, startDate, endDate);
      created += driverResult.created;
      errors.push(...driverResult.errors);
    }

    setProgress({ done: plan.length, total: plan.length });
    setResult({ created, errors });
    setRunning(false);
  }

  return (
    <div className="space-y-6">
      <form action={handleSubmit} className="flex flex-wrap items-end gap-4">
        <div>
          <label className={labelClass}>Data inicial *</label>
          <input type="date" name="startDate" required disabled={running} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Data final *</label>
          <input type="date" name="endDate" required disabled={running} className={inputClass} />
        </div>
        <button type="submit" disabled={running} className={primaryButtonClass}>
          {running ? "Importando..." : "Importar"}
        </button>
      </form>

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
            <span>
              Importação concluída — {result.created} registro(s) de ponto importado(s) com sucesso.
            </span>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-red-700">
                {result.errors.length} ocorrência(s) não importada(s):
              </p>
              <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-red-600">
                {result.errors.map((e, i) => (
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
