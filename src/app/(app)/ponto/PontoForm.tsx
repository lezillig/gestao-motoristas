"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import type { PontoFormState } from "./actions";

export default function PontoForm({
  action,
  drivers,
  defaultValues,
}: {
  action: (state: PontoFormState, formData: FormData) => Promise<PontoFormState>;
  drivers: { id: string; name: string }[];
  defaultValues?: {
    driverId: string;
    date: string;
    clockIn: string;
    clockOut: string | null;
    notes: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState<PontoFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      <div>
        <label className={labelClass}>Motorista *</label>
        <select name="driverId" required defaultValue={defaultValues?.driverId ?? ""} className={inputClass}>
          <option value="" disabled>
            Selecione
          </option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Data *</label>
        <input type="date" name="date" required defaultValue={defaultValues?.date} className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Entrada *</label>
          <input
            type="time"
            name="clockIn"
            required
            defaultValue={defaultValues?.clockIn}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Saída</label>
          <input
            type="time"
            name="clockOut"
            defaultValue={defaultValues?.clockOut ?? ""}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-400">Deixe em branco se o turno ainda está aberto.</p>
        </div>
      </div>
      <div>
        <label className={labelClass}>Observações</label>
        <input name="notes" defaultValue={defaultValues?.notes ?? ""} className={inputClass} />
      </div>
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Salvando..." : "Salvar"}
        </button>
        <Link href="/ponto" className={secondaryButtonClass}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
