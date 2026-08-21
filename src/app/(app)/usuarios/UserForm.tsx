"use client";

import Link from "next/link";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import { ROLE_LABELS } from "@/lib/permissions";

// CONTROLADORIA estava fora desta lista. Sem ela não havia como conceder o
// único perfil que vê o financeiro sem ver ponto, escala e dado pessoal de
// motorista — e dar acesso ao contador significava torná-lo ADMIN ou GESTOR.
const ROLE_OPTIONS = ["ADMIN", "GESTOR", "FOLHA", "CONTROLADORIA", "MOTORISTA"] as const;

// O que cada perfil enxerga, dito na hora da escolha.
//
// Quem concede acesso decide olhando para o rótulo. "Folha (acesso restrito)"
// não diz do que a pessoa fica restrita, e o custo de errar aqui é expor dado
// trabalhista para quem só precisava do financeiro.
const ROLE_DESCRICAO: Record<string, string> = {
  ADMIN: "Vê tudo e gerencia contas de acesso.",
  GESTOR: "Vê tudo da operação e da controladoria, mas não gerencia contas.",
  FOLHA: "Só o menu Folha: afastamentos, banco de horas, relatórios e histórico de correções.",
  CONTROLADORIA:
    "Só o menu Controladoria: financeiro, auditoria e conformidade. Não vê ponto, escala nem dado pessoal de motorista — é o perfil para contabilidade, inclusive terceirizada.",
  MOTORISTA: "Acesso próprio de motorista.",
};

export type ValoresUsuario = { name: string; email: string; role: string };

export default function UserForm({
  action,
  valores,
  edicao = false,
}: {
  action: (formData: FormData) => void;
  valores?: ValoresUsuario;
  edicao?: boolean;
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label className={labelClass}>Nome *</label>
        <input
          name="name"
          required
          defaultValue={valores?.name}
          className={inputClass}
          placeholder="Nome completo"
        />
      </div>

      <div>
        <label className={labelClass}>E-mail *</label>
        <input
          name="email"
          type="email"
          required
          defaultValue={valores?.email}
          className={inputClass}
          placeholder="pessoa@empresa.com"
        />
        {edicao && (
          <p className="mt-1 text-xs text-slate-500">
            É com este e-mail que a pessoa entra no sistema. Trocar aqui troca o login.
          </p>
        )}
      </div>

      <div>
        <label className={labelClass}>{edicao ? "Nova senha" : "Senha *"}</label>
        <input
          name="password"
          type="password"
          required={!edicao}
          minLength={edicao ? undefined : 6}
          className={inputClass}
          placeholder={edicao ? "Deixe em branco para manter a atual" : "Mínimo 6 caracteres"}
        />
        {edicao && (
          <p className="mt-1 text-xs text-slate-500">
            Em branco, a senha atual continua valendo. Preenchida, passa a valer no próximo acesso.
          </p>
        )}
      </div>

      <div>
        <label className={labelClass}>Tipo de acesso *</label>
        <select name="role" required defaultValue={valores?.role ?? "FOLHA"} className={inputClass}>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <ul className="mt-2 space-y-1">
          {ROLE_OPTIONS.map((r) => (
            <li key={r} className="text-xs leading-relaxed text-slate-500">
              <span className="font-medium text-slate-600">{ROLE_LABELS[r]}</span> — {ROLE_DESCRICAO[r]}
            </li>
          ))}
        </ul>
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
