"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import type { EscalaFormState } from "./actions";

export default function EscalaForm({
  action,
  drivers,
  vehicles,
  defaultValues,
}: {
  action: (state: EscalaFormState, formData: FormData) => Promise<EscalaFormState>;
  drivers: { id: string; name: string }[];
  vehicles: { id: string; plate: string; brand: string; model: string }[];
  defaultValues?: {
    driverId: string;
    vehicleId: string;
    date: string;
    startTime: string;
    endTime: string;
    notes: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState<EscalaFormState, FormData>(action, {});

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
        <label className={labelClass}>Veículo *</label>
        <select name="vehicleId" required defaultValue={defaultValues?.vehicleId ?? ""} className={inputClass}>
          <option value="" disabled>
            Selecione
          </option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate} · {v.brand} {v.model}
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
          <label className={labelClass}>Início *</label>
          <input
            type="time"
            name="startTime"
            required
            defaultValue={defaultValues?.startTime}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Fim *</label>
          <input
            type="time"
            name="endTime"
            required
            defaultValue={defaultValues?.endTime}
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>Observações</label>
        <input name="notes" defaultValue={defaultValues?.notes ?? ""} className={inputClass} />
      </div>
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Verificando conflitos..." : "Salvar"}
        </button>
        <Link href="/escalas" className={secondaryButtonClass}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
