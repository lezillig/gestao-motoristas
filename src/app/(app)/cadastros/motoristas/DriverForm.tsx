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
    regimeHoras?: string | null;
    escalaSemanal?: string | null;
    valorHoraCents?: number | null;
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
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Regime de horas</label>
          <select
            name="regimeHoras"
            defaultValue={defaultValues?.regimeHoras ?? ""}
            className={inputClass}
          >
            <option value="">— Segue a convenção do sindicato —</option>
            <option value="PADRAO">Padrão (jornada normal)</option>
            <option value="DOZE_X_TRINTA_SEIS">12x36</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">
            Prevalece sobre a CCT/ACT quando preenchido (acordo individual, art. 59-A CLT).
          </p>
        </div>
        <div>
          <label className={labelClass}>Escala</label>
          <select
            name="escalaSemanal"
            defaultValue={defaultValues?.escalaSemanal ?? ""}
            className={inputClass}
          >
            <option value="">— Sem escala especial —</option>
            <option value="SEIS_UM">6x1 (6 dias trabalhados, 1 de folga)</option>
            <option value="CINCO_DOIS">5x2 (5 dias trabalhados, 2 de folga)</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">Ajusta o alerta de descanso semanal na análise de riscos.</p>
        </div>
      </div>
      <div>
        <label className={labelClass}>Valor da hora (R$)</label>
        <input
          type="number"
          name="valorHora"
          step="0.01"
          min="0"
          defaultValue={
            defaultValues?.valorHoraCents != null ? (defaultValues.valorHoraCents / 100).toFixed(2) : ""
          }
          className={`${inputClass} max-w-[160px]`}
          placeholder="0,00"
        />
        <p className="mt-1 text-xs text-slate-400">Usado para calcular o custo de hora extra na análise de riscos.</p>
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
