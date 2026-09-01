"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { primaryButtonClass } from "@/lib/ui";
import { syncAnpPrices, type AnpSyncState } from "./actions";

export default function AnpSyncButton({ mes }: { mes: string }) {
  const boundAction = syncAnpPrices.bind(null, mes);
  const [state, formAction, pending] = useActionState<AnpSyncState, FormData>(boundAction, {});

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className={`${primaryButtonClass} inline-flex w-full items-center justify-center gap-2 py-1.5 text-xs disabled:opacity-60`}
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {pending ? "Buscando..." : "Buscar preços ANP"}
      </button>
      {state.result && (
        <p className="mt-1.5 text-xs text-slate-500">
          {state.result.weeksSynced > 0
            ? `${state.result.weeksSynced} semana(s) sincronizada(s), ${state.result.created} preço(s).`
            : "Nenhuma semana nova disponível ainda."}
        </p>
      )}
    </form>
  );
}
