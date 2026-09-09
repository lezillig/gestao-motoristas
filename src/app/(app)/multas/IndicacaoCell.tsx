"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { badgeClass, secondaryButtonClass } from "@/lib/ui";
import { definirCondutorManual, enviarIndicacaoCondutor } from "./actions";

type Driver = { id: string; name: string; cpf: string };
type Indicacao = {
  status: "PENDENTE_MANUAL" | "SUGERIDA" | "ENVIADA" | "VALIDADA" | "REJEITADA";
  driverId: string | null;
  origemResolucao: string | null;
  driver: { id: string; name: string; cpf: string; cnh: string | null } | null;
} | null;

const STATUS_LABEL: Record<string, string> = {
  PENDENTE_MANUAL: "Pendente — selecione o motorista",
  SUGERIDA: "Sugerido",
  ENVIADA: "Enviado à LW",
  VALIDADA: "Validado",
  REJEITADA: "Rejeitado",
};

const STATUS_BADGE: Record<string, string> = {
  PENDENTE_MANUAL: "bg-amber-100 text-amber-800",
  SUGERIDA: "bg-blue-100 text-blue-700",
  ENVIADA: "bg-emerald-100 text-emerald-700",
  VALIDADA: "bg-emerald-100 text-emerald-700",
  REJEITADA: "bg-red-100 text-red-700",
};

export default function IndicacaoCell({
  multaId,
  indicacao,
  drivers,
}: {
  multaId: string;
  indicacao: Indicacao;
  drivers: Driver[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const status = indicacao?.status ?? "PENDENTE_MANUAL";
  const isAuto = indicacao?.origemResolucao && indicacao.origemResolucao !== "MANUAL";

  function handleSelectDriver(driverId: string) {
    if (!driverId) return;
    setError(null);
    startTransition(async () => {
      const r = await definirCondutorManual(multaId, driverId);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  function handleEnviar() {
    setError(null);
    startTransition(async () => {
      const r = await enviarIndicacaoCondutor(multaId);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  const podeEditar = status === "PENDENTE_MANUAL" || status === "SUGERIDA";
  const podeEnviar = status === "SUGERIDA" && indicacao?.driverId;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-2">
        <span className={`${badgeClass} ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
        {isAuto && status === "SUGERIDA" && <span className="text-[11px] text-slate-400">sugestão automática</span>}
      </div>

      {indicacao?.driver && <p className="text-xs text-slate-600">{indicacao.driver.name}</p>}

      {podeEditar && (
        <select
          disabled={pending}
          defaultValue={indicacao?.driverId ?? ""}
          onChange={(e) => handleSelectDriver(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-60"
        >
          <option value="">Selecionar motorista...</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}

      {podeEnviar && (
        <button
          type="button"
          onClick={handleEnviar}
          disabled={pending}
          className={`${secondaryButtonClass} inline-flex items-center gap-1.5 px-2 py-1 text-[11px] disabled:opacity-60`}
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Enviar indicação
        </button>
      )}

      {error && <p className="max-w-[220px] text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
