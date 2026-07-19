"use client";

import Link from "next/link";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";

export default function SindicatoForm({
  action,
  defaultValues,
}: {
  action: (formData: FormData) => void;
  defaultValues?: {
    nome: string;
    cnpj: string | null;
    cidade: string | null;
    estado: string | null;
  };
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label className={labelClass}>Nome do sindicato *</label>
        <input
          name="nome"
          required
          defaultValue={defaultValues?.nome}
          className={inputClass}
          placeholder="Ex: SETCEPAR"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Cidade</label>
          <input name="cidade" defaultValue={defaultValues?.cidade ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>UF</label>
          <input
            name="estado"
            maxLength={2}
            defaultValue={defaultValues?.estado ?? ""}
            className={`${inputClass} uppercase`}
            placeholder="PR"
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>CNPJ</label>
        <input name="cnpj" defaultValue={defaultValues?.cnpj ?? ""} className={inputClass} />
      </div>
      <div className="mt-2 flex gap-3">
        <button type="submit" className={primaryButtonClass}>
          Salvar
        </button>
        <Link href="/cadastros/sindicatos" className={secondaryButtonClass}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
