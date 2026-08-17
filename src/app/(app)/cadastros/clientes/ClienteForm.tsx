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
    horarioInicioContratado?: string | null;
    horarioFimContratado?: string | null;
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
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Início da janela contratada</label>
          <input
            type="time"
            name="horarioInicioContratado"
            defaultValue={defaultValues?.horarioInicioContratado ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Fim da janela contratada</label>
          <input
            type="time"
            name="horarioFimContratado"
            defaultValue={defaultValues?.horarioFimContratado ?? ""}
            className={inputClass}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-slate-400">
        Horário estimado de início/fim de operação exigido pelo contrato — usado para calcular a demanda de
        motoristas do cliente.
      </p>
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
