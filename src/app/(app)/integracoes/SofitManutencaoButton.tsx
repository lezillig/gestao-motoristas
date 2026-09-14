"use client";

import { useState } from "react";
import { Loader2, Wrench } from "lucide-react";
import { secondaryButtonClass } from "@/lib/ui";
import { syncManutencaoSofit } from "../manutencao/actions";

// Loop no navegador enquanto hasMore — a carga inicial (5 mil+ OS) leva 2-3
// lotes; a diaria, 1. Mesmo padrao do backfill de combustivel da Sofit.
export default function SofitManutencaoButton() {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setRunning(true);
    setMsg(null);
    let since: string | null = null;
    let os = 0;
    let lotes = 0;
    let veiculos: { atualizados: number; semPar: number; vencimentos: number } | undefined;
    let ultima = 0;
    try {
      for (;;) {
        const r = await syncManutencaoSofit(since);
        if (r.error || !r.result) {
          setMsg({ ok: false, text: r.error ?? "Falha ao sincronizar." });
          return;
        }
        lotes++;
        os += r.result.osUpserted;
        if (r.result.veiculos) veiculos = r.result.veiculos;
        if (r.result.ultimaManutencaoAtualizada != null) ultima = r.result.ultimaManutencaoAtualizada;
        setMsg({ ok: true, text: `Lote ${lotes}: ${os} OS até agora…` });
        if (!r.result.hasMore || lotes >= 20) break;
        since = r.result.nextSince;
      }
      setMsg({
        ok: true,
        text: `${os} OS importada(s)/atualizada(s)` +
          (veiculos ? ` · ${veiculos.atualizados} veículo(s) da Sofit casados (${veiculos.semPar} sem par) · ${veiculos.vencimentos} vencimento(s)` : "") +
          (ultima > 0 ? ` · última manutenção atualizada em ${ultima} veículo(s)` : "") +
          ".",
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Falha inesperada." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={run} disabled={running} className={`${secondaryButtonClass} inline-flex w-fit items-center gap-1.5 text-xs disabled:opacity-60`}>
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
        {running ? "Sincronizando manutenção…" : "Sincronizar manutenção (OS, frota, vencimentos)"}
      </button>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
