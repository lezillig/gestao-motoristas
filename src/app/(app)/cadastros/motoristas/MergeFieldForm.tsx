"use client";

import { useActionState, useState } from "react";
import { ChevronDown, ChevronRight, Merge, AlertTriangle, CheckCircle2 } from "lucide-react";
import { inputClass, secondaryButtonClass } from "@/lib/ui";
import ComboboxFilter from "@/components/ui/ComboboxFilter";
import { mergeDriverFieldValue, type MergeField, type MergeFieldState } from "./actions";

const FIELD_LABELS: Record<MergeField, string> = {
  empregador: "Empregador",
  departamento: "Unidade de alocação",
  funcao: "Cargo",
  sindicato: "Sindicato",
};

export default function MergeFieldForm({
  empregadores,
  departamentos,
  cargos,
  sindicatos,
}: {
  empregadores: string[];
  departamentos: string[];
  cargos: string[];
  sindicatos: { id: string; nome: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<MergeField>("empregador");
  const [state, formAction, pending] = useActionState<MergeFieldState, FormData>(mergeDriverFieldValue, {});

  const options =
    field === "sindicato"
      ? sindicatos.map((s) => ({ value: s.id, label: s.nome }))
      : { empregador: empregadores, departamento: departamentos, funcao: cargos }[field].map((v) => ({
          value: v,
          label: v,
        }));

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Unificar valores duplicados (empregador / unidade de alocação / cargo / sindicato)
      </button>

      {open && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="mb-3 text-xs text-slate-500">
            Empregador, unidade de alocação e cargo são texto livre vindo de fontes diferentes (importação,
            cadastro manual) — a mesma empresa ou unidade pode acabar com grafias diferentes (ex.:
            &quot;AZUL&quot; e &quot;Azul Transportes e Turismo LTDA&quot;). Escolha o valor errado
            (&quot;De&quot;) e o certo (&quot;Para&quot;) — todo motorista com o valor &quot;De&quot; passa a
            usar o &quot;Para&quot;. Para Sindicato, &quot;De&quot;/&quot;Para&quot; são dois sindicatos já
            cadastrados: todo motorista do &quot;De&quot; passa pro &quot;Para&quot;, e o &quot;De&quot; fica
            desativado (não é apagado, só some das opções).
          </p>
          <form action={formAction} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Campo</label>
              <select
                name="field"
                value={field}
                onChange={(e) => setField(e.target.value as MergeField)}
                className={inputClass}
              >
                {Object.entries(FIELD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-56">
              <ComboboxFilter key={`from-${field}`} name="from" label="De (valor errado)" options={options} allLabel="Selecione" />
            </div>
            <div className="w-56">
              <ComboboxFilter key={`to-${field}`} name="to" label="Para (valor certo)" options={options} allLabel="Selecione" />
            </div>
            <button
              type="submit"
              disabled={pending}
              className={`${secondaryButtonClass} inline-flex items-center gap-2`}
            >
              <Merge className="h-4 w-4" /> {pending ? "Unificando..." : "Unificar"}
            </button>
          </form>

          {state.error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{state.error}</span>
            </div>
          )}
          {state.result && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{state.result.updated} motorista(s) atualizado(s).</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
