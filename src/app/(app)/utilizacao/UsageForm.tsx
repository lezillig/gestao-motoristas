"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import type { UsageFormState } from "./actions";

export default function UsageForm({
  action,
  drivers,
  vehicles,
}: {
  action: (state: UsageFormState, formData: FormData) => Promise<UsageFormState>;
  drivers: { id: string; name: string }[];
  vehicles: { id: string; plate: string; currentMileage: number }[];
}) {
  const [state, formAction, pending] = useActionState<UsageFormState, FormData>(action, {});
  const today = new Date().toISOString().slice(0, 10);

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
        <select name="driverId" required defaultValue="" className={inputClass}>
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
        <select name="vehicleId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Selecione
          </option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate} · {v.currentMileage} km
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Data *</label>
          <input type="date" name="date" required defaultValue={today} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Hora do check-in *</label>
          <input type="time" name="time" required className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Km inicial *</label>
        <input type="number" name="kmInicial" required min={0} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Observações</label>
        <input name="notes" className={inputClass} />
      </div>
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Salvando..." : "Registrar check-in"}
        </button>
        <Link href="/utilizacao" className={secondaryButtonClass}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
