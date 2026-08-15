"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { primaryButtonClass } from "@/lib/ui";
import {
  importDriversFromTiqueTaque,
  syncDriversFromTiqueTaque,
  type TiqueTaqueDriverImportState,
  type TiqueTaqueSyncState,
} from "./actions";

export default function TiqueTaqueDriverImportButton() {
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<TiqueTaqueDriverImportState | null>(null);
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncState, setSyncState] = useState<TiqueTaqueSyncState | null>(null);

  async function handleClick() {
    setRunning(true);
    setState(null);
    const result = await importDriversFromTiqueTaque();
    setState(result);
    setRunning(false);
  }

  async function handleSyncClick() {
    setSyncRunning(true);
    setSyncState(null);
    const result = await syncDriversFromTiqueTaque();
    setSyncState(result);
    setSyncRunning(false);
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={handleClick} disabled={running} className={primaryButtonClass}>
        {running ? "Importando..." : "Importar funcionários ativos do TiqueTaque"}
      </button>
      <p className="text-xs text-slate-400">
        Traz nome, CPF, telefone e valor-hora de todos os funcionários ativos (não só motoristas). CNH não vem
        do TiqueTaque — os importados aparecem como "CNH pendente" até serem completados.
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

      <div className="border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={handleSyncClick}
          disabled={syncRunning}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {syncRunning
            ? "Atualizando..."
            : "Atualizar empregador, cargo, unidade de alocação e status dos já cadastrados"}
        </button>
        <p className="mt-2 text-xs text-slate-400">
          Casa por CPF com os motoristas já cadastrados e atualiza empregador, cargo, unidade de alocação
          (centro de custos) e ativo/inativo conforme o TiqueTaque — não cria nem apaga nenhum motorista, e
          quem não tem CPF correspondente no TiqueTaque fica intocado.
        </p>

        {syncState?.error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{syncState.error}</span>
          </div>
        )}

        {syncState?.result && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {syncState.result.updated} atualizado(s), {syncState.result.unchanged} já em dia,{" "}
              {syncState.result.notFound} sem correspondência no TiqueTaque.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
