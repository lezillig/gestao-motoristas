"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { syncFromSiat, type SiatSyncResult } from "./siatActions";

// Sincronizar reservas dia a dia no SIAT e lento (chamada por dia, com
// pacing) — um periodo de poucas semanas leva segundos, mas meses/anos
// pode levar minutos e nao tem nenhum feedback visual continuo alem do
// texto do botao, o que pareceu "travado" pra quem tava usando (relato
// real). O cronometro abaixo so existe pra provar que ainda esta vivo.
export default function SiatSyncForm() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SiatSyncResult | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function handleSubmit(formData: FormData) {
    const dateFrom = String(formData.get("dateFrom") ?? "");
    const dateTo = String(formData.get("dateTo") ?? "");
    setRunning(true);
    setError(null);
    setResult(null);
    setElapsedSeconds(0);
    intervalRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    try {
      const r = await syncFromSiat(dateFrom, dateTo);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao sincronizar com o SIAT.");
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
  }

  return (
    <div className="space-y-6">
      <form action={handleSubmit} className="flex flex-wrap items-end gap-4">
        <div>
          <label className={labelClass}>Data inicial *</label>
          <input type="date" name="dateFrom" required disabled={running} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Data final *</label>
          <input type="date" name="dateTo" required disabled={running} className={inputClass} />
        </div>
        <button type="submit" disabled={running} className={`${primaryButtonClass} flex items-center gap-2`}>
          {running && <Loader2 className="h-4 w-4 animate-spin" />}
          {running ? `Sincronizando... (${elapsedSeconds}s)` : "Sincronizar"}
        </button>
      </form>
      <p className="-mt-3 text-xs text-slate-400">
        Sincroniza veículos e motoristas (cria quando o SIAT traz CPF, senão só enriquece um cadastro já existente)
        e, no período escolhido, as reservas/viagens como escalas (fonte oficial — sincronizações seguintes
        atualizam livremente o que já veio de lá). Períodos longos (vários meses) buscam dia a dia no SIAT e podem
        levar minutos — o contador acima confirma que ainda está rodando, mesmo sem outra mudança na tela.
      </p>

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
              Veículos: {result.vehicles.created} novo(s), {result.vehicles.updated} atualizado(s). Motoristas:{" "}
              {result.drivers.created} novo(s), {result.drivers.updated} atualizado(s),{" "}
              {result.drivers.unmatched} sem correspondência (sem CPF no SIAT). Escalas: {result.escalas.created}{" "}
              nova(s), {result.escalas.updated} atualizada(s).
            </span>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-amber-700">
                {result.errors.length} ocorrência(s) a conferir:
              </p>
              <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-amber-700">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    {e.context}: {e.message}
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
