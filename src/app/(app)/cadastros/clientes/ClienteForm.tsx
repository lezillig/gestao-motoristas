"use client";

import Link from "next/link";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";

export default function ClienteForm({
  action,
  defaultValues,
}: {
  action: (formData: FormData) => void;
  defaultValues?: {
    nome: string;
  };
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label className={labelClass}>Nome do cliente *</label>
        <input
          name="nome"
          required
          defaultValue={defaultValues?.nome}
          className={inputClass}
          placeholder="Ex: FEMSA Jundiaí"
        />
      </div>
      <div className="mt-2 flex gap-3">
        <button type="submit" className={primaryButtonClass}>
          Salvar
        </button>
        <Link href="/cadastros/clientes" className={secondaryButtonClass}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
