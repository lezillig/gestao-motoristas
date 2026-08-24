"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AlertTriangle } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import type { VehicleFormState } from "./actions";

export default function VehicleForm({
  action,
  defaultValues,
}: {
  action: (state: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;
  defaultValues?: {
    plate: string;
    brand: string;
    model: string;
    year: number | null;
    type: string;
    status: string;
  };
}) {
  const [state, formAction, pending] = useActionState<VehicleFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Placa *</label>
          <input
            name="plate"
            required
            defaultValue={defaultValues?.plate}
            className={`${inputClass} uppercase`}
            placeholder="ABC1D23"
          />
        </div>
        <div>
          <label className={labelClass}>Ano</label>
          <input
            type="number"
            name="year"
            min={1980}
            max={2100}
            defaultValue={defaultValues?.year ?? undefined}
            className={inputClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Marca *</label>
          <input name="brand" required defaultValue={defaultValues?.brand} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Modelo *</label>
          <input name="model" required defaultValue={defaultValues?.model} className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Tipo *</label>
          <input
            name="type"
            required
            defaultValue={defaultValues?.type}
            className={inputClass}
            placeholder="Ônibus rodoviário, Van..."
          />
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <select name="status" defaultValue={defaultValues?.status ?? "ATIVO"} className={inputClass}>
            <option value="ATIVO">Ativo</option>
            <option value="MANUTENCAO">Em manutenção</option>
            <option value="INATIVO">Inativo</option>
          </select>
        </div>
      </div>
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} disabled:opacity-60`}>
          {pending ? "Salvando..." : "Salvar"}
        </button>
        <Link href="/cadastros/veiculos" className={secondaryButtonClass}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
