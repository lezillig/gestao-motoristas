"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { primaryButtonClass } from "@/lib/ui";
import { prepareMultasSync, syncMultasVehicle } from "./actions";
import { sleep } from "@/lib/tiquetaque/pace";

// Limite de requisicoes da LW nao e documentado — 250ms entre chamadas e
// conservador o bastante (testado sem nenhum 429 numa varredura manual da
// frota inteira, ~200 chamadas, com 150ms de pausa — ver investigacao
// 2026-09-09). 1 veiculo por chamada, nao a frota inteira numa invocacao
// so, mesmo motivo do TiqueTaque/Ituran (evitar timeout de funcao
// serverless) — ver src/lib/lw/sync.ts.
const LW_SYNC_PACE_MS = 250;

type State = { status: "idle" | "running" | "done" | "error"; message?: string; progress?: { done: number; total: number } };

export default function MultasSyncButton() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });

  async function handleClick() {
    setState({ status: "running" });
    try {
      const plan = await prepareMultasSync();
      let criadas = 0;
      let atualizadas = 0;
      const erros: string[] = [];

      for (let i = 0; i < plan.itens.length; i++) {
        const item = plan.itens[i];
        setState({ status: "running", progress: { done: i, total: plan.itens.length } });
        if (i > 0) await sleep(LW_SYNC_PACE_MS);
        const r = await syncMultasVehicle(item.vehicleId, item.placaParaConsulta);
        if ("error" in r) erros.push(`${item.plate}: ${r.error}`);
        else {
          criadas += r.criadas;
          atualizadas += r.atualizadas;
        }
      }

      const semCorrespondencia = plan.semCorrespondenciaNaLw.length;
      setState({
        status: erros.length > 0 ? "error" : "done",
        message:
          `${criadas} nova(s), ${atualizadas} atualizada(s).` +
          (semCorrespondencia > 0 ? ` ${semCorrespondencia} veículo(s) sem cadastro na LW.` : "") +
          (erros.length > 0 ? ` ${erros.length} erro(s): ${erros.slice(0, 3).join("; ")}` : ""),
      });
      router.refresh();
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={state.status === "running"}
        className={`${primaryButtonClass} inline-flex items-center gap-2 disabled:opacity-60`}
      >
        {state.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {state.status === "running"
          ? state.progress
            ? `Sincronizando... ${state.progress.done}/${state.progress.total}`
            : "Sincronizando..."
          : "Sincronizar multas"}
      </button>
      {state.message && (
        <p className={`max-w-md text-right text-xs ${state.status === "error" ? "text-red-600" : "text-emerald-700"}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}
