"use client";

import { useActionState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { TIPO_REGRA_LABELS } from "@/lib/convencao";
import type { RegraFormState } from "./actions";

export default function RegraForm({
  action,
}: {
  action: (state: RegraFormState, formData: FormData) => Promise<RegraFormState>;
}) {
  const [state, formAction, pending] = useActionState<RegraFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-300 p-4">
      {state.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Tipo *</label>
          <select name="tipo" required defaultValue="JORNADA_DIARIA" className={inputClass}>
            {Object.entries(TIPO_REGRA_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Valor numérico</label>
          <input type="number" step="0.5" name="valorNumerico" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Descrição</label>
          <input name="descricao" className={inputClass} placeholder="Observação livre" />
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Unidade do valor: horas (jornada diária, banco de horas) · % (hora extra, adicional noturno) · minutos (intervalo).
      </p>
      <button type="submit" disabled={pending} className={`${primaryButtonClass} flex w-fit items-center gap-1.5`}>
        <Plus className="h-3.5 w-3.5" /> {pending ? "Adicionando..." : "Adicionar regra"}
      </button>
    </form>
  );
}
