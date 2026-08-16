"use client";

import Link from "next/link";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { ROLE_LABELS } from "@/lib/permissions";

const ROLE_OPTIONS = ["ADMIN", "GESTOR", "FOLHA", "MOTORISTA"] as const;

export default function UserForm({ action }: { action: (formData: FormData) => void }) {
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label className={labelClass}>Nome *</label>
        <input name="name" required className={inputClass} placeholder="Nome completo" />
      </div>
      <div>
        <label className={labelClass}>E-mail *</label>
        <input name="email" type="email" required className={inputClass} placeholder="pessoa@empresa.com" />
      </div>
      <div>
        <label className={labelClass}>Senha *</label>
        <input name="password" type="password" required minLength={6} className={inputClass} placeholder="Mínimo 6 caracteres" />
      </div>
      <div>
        <label className={labelClass}>Tipo de acesso *</label>
        <select name="role" required defaultValue="FOLHA" className={inputClass}>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Folha vê apenas o menu Folha (Afastamentos, Banco de horas, Relatórios, Histórico de correções).
        </p>
      </div>
      <div className="mt-2 flex gap-3">
        <button type="submit" className={primaryButtonClass}>
          Salvar
        </button>
        <Link href="/usuarios" className={secondaryButtonClass}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
