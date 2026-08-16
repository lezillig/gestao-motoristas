"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import type { EscalaFormState } from "./actions";

export default function EscalaForm({
  action,
  drivers,
  vehicles,
  defaultValues,
}: {
  action: (state: EscalaFormState, formData: FormData) => Promise<EscalaFormState>;
  drivers: { id: string; name: string }[];
  vehicles: { id: string; plate: string; brand: string; model: string }[];
  defaultValues?: {
    driverId: string;
    vehicleId: string;
    date: string;
    startTime: string;
    endTime: string;
    notes: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState<EscalaFormState, FormData>(action, {});
  const confirmRef = useRef<HTMLInputElement>(null);

  // React 19 reseta campos nao controlados assim que a Server Action
  // retorna — sem isso, o fluxo "salvar mesmo assim" do aviso de
  // interjornada reenviaria o formulario vazio no segundo clique (bug real
  // encontrado ao testar). `version` muda a cada retorno da action,
  // forcando os campos abaixo a remontar com os valores devolvidos em
  // `state.values` em vez de ficarem em branco.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (state.values) setVersion((v) => v + 1);
  }, [state]);
  const effective = state.values ?? {
    driverId: defaultValues?.driverId ?? "",
    vehicleId: defaultValues?.vehicleId ?? "",
    date: defaultValues?.date ?? "",
    startTime: defaultValues?.startTime ?? "",
    endTime: defaultValues?.endTime ?? "",
    notes: defaultValues?.notes ?? "",
  };

  return (
    <form
      action={formAction}
      onChange={() => {
        // Qualquer mudança no formulário invalida uma confirmação anterior
        // de "salvar mesmo assim" — evita reaproveitar a confirmação pra um
        // horário/motorista diferente do que foi avisado.
        if (confirmRef.current) confirmRef.current.value = "";
      }}
      className="flex flex-col gap-4"
    >
      <input ref={confirmRef} type="hidden" name="confirmInterjornada" defaultValue="" />
      {state.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      {state.warning && !state.error && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{state.warning}</p>
            <button
              type="submit"
              onClick={() => {
                if (confirmRef.current) confirmRef.current.value = "true";
              }}
              className="mt-2 text-xs font-medium text-amber-900 underline"
            >
              Salvar mesmo assim
            </button>
          </div>
        </div>
      )}
      <div>
        <label className={labelClass}>Motorista *</label>
        <select key={`driverId-${version}`} name="driverId" required defaultValue={effective.driverId} className={inputClass}>
          <option value="" disabled>
            Selecione
          </option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Veículo *</label>
        <select key={`vehicleId-${version}`} name="vehicleId" required defaultValue={effective.vehicleId} className={inputClass}>
          <option value="" disabled>
            Selecione
          </option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate} · {v.brand} {v.model}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Data *</label>
        <input
          key={`date-${version}`}
          type="date"
          name="date"
          required
          defaultValue={effective.date}
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Início *</label>
          <input
            key={`startTime-${version}`}
            type="time"
            name="startTime"
            required
            defaultValue={effective.startTime}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Fim *</label>
          <input
            key={`endTime-${version}`}
            type="time"
            name="endTime"
            required
            defaultValue={effective.endTime}
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>Observações</label>
        <input key={`notes-${version}`} name="notes" defaultValue={effective.notes} className={inputClass} />
      </div>
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Verificando conflitos..." : "Salvar"}
        </button>
        <Link href="/escalas" className={secondaryButtonClass}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
