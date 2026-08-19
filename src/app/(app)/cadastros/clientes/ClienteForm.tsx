"use client";

import Link from "next/link";
import { useState } from "react";
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
    latitude?: number | null;
    longitude?: number | null;
  };
}) {
  const [latitude, setLatitude] = useState(defaultValues?.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(defaultValues?.longitude?.toString() ?? "");
  const mapsHref = latitude && longitude ? `https://www.google.com/maps?q=${latitude},${longitude}` : null;

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
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Latitude do local esperado</label>
          <input
            type="number"
            step="any"
            name="latitude"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            className={inputClass}
            placeholder="Ex: -23.5505"
          />
        </div>
        <div>
          <label className={labelClass}>Longitude do local esperado</label>
          <input
            type="number"
            step="any"
            name="longitude"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            className={inputClass}
            placeholder="Ex: -46.6333"
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-slate-400">
        Onde os motoristas deste cliente deveriam bater o ponto — usado para comparar contra a geolocalização das
        marcações reais.
        {mapsHref && (
          <>
            {" "}
            <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              Ver no mapa
            </a>
          </>
        )}
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
