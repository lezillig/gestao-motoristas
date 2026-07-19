"use client";

import { useActionState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { primaryButtonClass, secondaryButtonClass, cardClass } from "@/lib/ui";
import { TIPO_REGRA_LABELS, TIPO_REGRA_UNIDADE } from "@/lib/convencao";
import type { SuggestRegrasState } from "./actions";

export default function AiSuggestionsPanel({
  suggestAction,
  addSuggestedAction,
}: {
  suggestAction: (state: SuggestRegrasState, formData: FormData) => Promise<SuggestRegrasState>;
  addSuggestedAction: (formData: FormData) => void;
}) {
  const [state, formAction, pending] = useActionState<SuggestRegrasState, FormData>(suggestAction, {});

  return (
    <div className={`${cardClass} mb-4`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Sparkles className="h-4 w-4 text-blue-700" /> Extração assistida por IA
        </h2>
        <form action={formAction}>
          <button type="submit" disabled={pending} className={secondaryButtonClass}>
            {pending ? "Lendo o PDF..." : "Sugerir regras com IA"}
          </button>
        </form>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        A IA lê o PDF e sugere regras — nada é ativado automaticamente. Revise e adicione cada sugestão manualmente.
      </p>

      {state.error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {state.suggestions && state.suggestions.length === 0 && (
        <p className="text-sm text-slate-500">Nenhuma regra quantificável identificada no PDF.</p>
      )}

      {state.suggestions && state.suggestions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {state.suggestions.map((s, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium text-slate-800">
                  {TIPO_REGRA_LABELS[s.tipo]}
                  {s.valorNumerico !== null && ` · ${s.valorNumerico} ${TIPO_REGRA_UNIDADE[s.tipo]}`}
                </p>
                <p className="text-xs text-slate-500">{s.descricao}</p>
              </div>
              <form action={addSuggestedAction}>
                <input type="hidden" name="tipo" value={s.tipo} />
                <input type="hidden" name="valorNumerico" value={s.valorNumerico ?? ""} />
                <input type="hidden" name="descricao" value={s.descricao} />
                <button type="submit" className={`${primaryButtonClass} py-1.5 text-xs`}>
                  Adicionar
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
