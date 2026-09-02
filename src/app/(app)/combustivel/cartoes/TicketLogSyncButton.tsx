"use client";

import { useActionState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { primaryButtonClass } from "@/lib/ui";
import { syncTicketLogCardStatuses, type TicketLogSyncState } from "./actions";

export default function TicketLogSyncButton() {
  const [state, formAction, pending] = useActionState<TicketLogSyncState, FormData>(syncTicketLogCardStatuses, {});

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className={`${primaryButtonClass} inline-flex items-center gap-2 disabled:opacity-60`}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {pending ? "Sincronizando..." : "Sincronizar com Ticket Log"}
        </button>
      </form>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.result && <p className="text-xs text-slate-500">{state.result.count} cartão(ões) atualizado(s).</p>}
    </div>
  );
}
