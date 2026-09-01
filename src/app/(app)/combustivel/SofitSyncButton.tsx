"use client";

import { useActionState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { secondaryButtonClass } from "@/lib/ui";
import { syncSofitFuel, type SofitSyncState } from "./sofitActions";

export default function SofitSyncButton() {
  const [state, formAction, pending] = useActionState<SofitSyncState, FormData>(syncSofitFuel, {});

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <button type="submit" disabled={pending} className={`${secondaryButtonClass} inline-flex items-center gap-2 text-sm disabled:opacity-60`}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {pending ? "Sincronizando..." : "Sincronizar com Sofit"}
        </button>
      </form>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.result && (
        <p className="text-xs text-slate-500">
          {state.result.created} novo(s) importado(s)
          {state.result.skipped > 0 ? `, ${state.result.skipped} ignorado(s) (sem placa ou valor)` : ""}.
        </p>
      )}
    </div>
  );
}
