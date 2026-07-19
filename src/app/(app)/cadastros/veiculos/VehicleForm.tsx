"use client";

import Link from "next/link";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";

export default function VehicleForm({
  action,
  defaultValues,
}: {
  action: (formData: FormData) => void;
  defaultValues?: {
    plate: string;
    brand: string;
    model: string;
    year: number;
    type: string;
    status: string;
  };
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
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
          <label className={labelClass}>Ano *</label>
          <input
            type="number"
            name="year"
            required
            min={1980}
            max={2100}
            defaultValue={defaultValues?.year}
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
        <button type="submit" className={primaryButtonClass}>
          Salvar
        </button>
        <Link href="/cadastros/veiculos" className={secondaryButtonClass}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
