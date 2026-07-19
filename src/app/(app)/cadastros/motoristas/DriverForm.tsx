"use client";

import Link from "next/link";
import { format } from "date-fns";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";

export default function DriverForm({
  action,
  sindicatos,
  defaultValues,
}: {
  action: (formData: FormData) => void;
  sindicatos: { id: string; nome: string }[];
  defaultValues?: {
    name: string;
    cpf: string;
    cnh: string;
    cnhCategory: string;
    cnhExpiration: Date;
    phone: string | null;
    sindicatoId: string | null;
  };
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label className={labelClass}>Nome completo *</label>
        <input name="name" required defaultValue={defaultValues?.name} className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>CPF *</label>
          <input
            name="cpf"
            required
            defaultValue={defaultValues?.cpf}
            className={inputClass}
            placeholder="000.000.000-00"
          />
        </div>
        <div>
          <label className={labelClass}>Telefone</label>
          <input name="phone" defaultValue={defaultValues?.phone ?? ""} className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>Nº da CNH *</label>
          <input name="cnh" required defaultValue={defaultValues?.cnh} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Categoria *</label>
          <input
            name="cnhCategory"
            required
            defaultValue={defaultValues?.cnhCategory}
            className={`${inputClass} uppercase`}
            placeholder="D"
          />
        </div>
        <div>
          <label className={labelClass}>Vencimento CNH *</label>
          <input
            type="date"
            name="cnhExpiration"
            required
            defaultValue={
              defaultValues?.cnhExpiration
                ? format(defaultValues.cnhExpiration, "yyyy-MM-dd")
                : undefined
            }
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>Sindicato</label>
        <select
          name="sindicatoId"
          defaultValue={defaultValues?.sindicatoId ?? ""}
          className={inputClass}
        >
          <option value="">— Sem sindicato —</option>
          {sindicatos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex gap-3">
        <button type="submit" className={primaryButtonClass}>
          Salvar
        </button>
        <Link href="/cadastros/motoristas" className={secondaryButtonClass}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
