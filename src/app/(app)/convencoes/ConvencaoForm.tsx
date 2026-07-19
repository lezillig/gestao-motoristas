"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import type { ConvencaoFormState } from "./actions";

export default function ConvencaoForm({
  action,
  sindicatos,
}: {
  action: (state: ConvencaoFormState, formData: FormData) => Promise<ConvencaoFormState>;
  sindicatos: { id: string; nome: string }[];
}) {
  const [state, formAction, pending] = useActionState<ConvencaoFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      <div>
        <label className={labelClass}>Sindicato *</label>
        <select name="sindicatoId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Selecione
          </option>
          {sindicatos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Início da vigência *</label>
          <input type="date" name="vigenciaInicio" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Fim da vigência</label>
          <input type="date" name="vigenciaFim" className={inputClass} />
          <p className="mt-1 text-xs text-slate-400">Deixe em branco se for por prazo indeterminado.</p>
        </div>
      </div>
      <div>
        <label className={labelClass}>Arquivo PDF *</label>
        <input type="file" name="arquivo" accept="application/pdf" required className={inputClass} />
      </div>
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Enviando..." : "Salvar"}
        </button>
        <Link href="/convencoes" className={secondaryButtonClass}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
