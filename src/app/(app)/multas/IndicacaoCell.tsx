"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Pencil, RefreshCw, Send, XCircle } from "lucide-react";
import { badgeClass, secondaryButtonClass } from "@/lib/ui";
import { definirCondutorManual, enviarIndicacaoCondutor, verificarStatusIndicacao, marcarIndicacaoResultado } from "./actions";
import DriverPicker from "./DriverPicker";

type Driver = { id: string; name: string; cpf: string };
type Indicacao = {
  status: "PENDENTE_MANUAL" | "SUGERIDA" | "ENVIADA" | "VALIDADA" | "REJEITADA";
  driverId: string | null;
  origemResolucao: string | null;
  observacao: string | null;
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

// Rotulo por origem da resolucao automatica (ver src/lib/lw/resolveCondutor.ts)
// — o usuario pediu pra deixar explicito quando a sugestao veio da Escala
// planejada (SIAT) em vez do uso real do veiculo, ja que sao fontes com
// confiabilidade diferente (uso real reflete quem de fato pegou o veiculo;
// escala e so o planejado, pode ter sido trocado na hora).
const ORIGEM_LABEL: Record<string, string> = {
  USO_VEICULO_AUTOMATICO: "sugestão automática (uso real do veículo)",
  ESCALA_AUTOMATICA: "sugestão automática (escala no SIAT)",
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
  const [descricaoLw, setDescricaoLw] = useState<string | null>(indicacao?.observacao ?? null);
  // So monta o DriverPicker (com sua lista de ~170 motoristas) quando a
  // pessoa realmente pede pra editar — com centenas de multas na tela ao
  // mesmo tempo, montar um combobox de busca em TODA linha de uma vez
  // ainda e caro o bastante pra travar a interacao (confirmado real
  // 2026-09-10, mesmo motivo que tirou o <select> nativo daqui).
  const [editando, setEditando] = useState(false);

  const status = indicacao?.status ?? "PENDENTE_MANUAL";
  const isAuto = indicacao?.origemResolucao && indicacao.origemResolucao !== "MANUAL";

  function handleSelectDriver(driverId: string) {
    if (!driverId) return;
    setError(null);
    startTransition(async () => {
      const r = await definirCondutorManual(multaId, driverId);
      if (r.error) setError(r.error);
      else {
        setEditando(false);
        router.refresh();
      }
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

  function handleVerificarStatus() {
    setError(null);
    startTransition(async () => {
      const r = await verificarStatusIndicacao(multaId);
      if (r.error) setError(r.error);
      else setDescricaoLw(r.descricao ?? null);
    });
  }

  function handleMarcarResultado(resultado: "VALIDADA" | "REJEITADA") {
    setError(null);
    startTransition(async () => {
      const r = await marcarIndicacaoResultado(multaId, resultado);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  const podeEditar = status === "PENDENTE_MANUAL" || status === "SUGERIDA";
  const podeEnviar = status === "SUGERIDA" && indicacao?.driverId;
  const podeVerificarEClassificar = status === "ENVIADA";

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-2">
        <span className={`${badgeClass} ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
        {isAuto && status === "SUGERIDA" && (
          <span className="text-[11px] text-slate-400">
            {ORIGEM_LABEL[indicacao!.origemResolucao!] ?? "sugestão automática"}
          </span>
        )}
      </div>

      {indicacao?.driver && !editando && <p className="text-xs text-slate-600">{indicacao.driver.name}</p>}

      {podeEditar && !editando && (
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline"
        >
          <Pencil className="h-3 w-3" />
          {indicacao?.driver ? "Editar" : "Selecionar motorista"}
        </button>
      )}

      {podeEditar && editando && (
        <DriverPicker drivers={drivers} selectedId={indicacao?.driverId ?? null} onSelect={handleSelectDriver} disabled={pending} />
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

      {podeVerificarEClassificar && (
        <>
          <button
            type="button"
            onClick={handleVerificarStatus}
            disabled={pending}
            className={`${secondaryButtonClass} inline-flex items-center gap-1.5 px-2 py-1 text-[11px] disabled:opacity-60`}
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Verificar status na LW
          </button>
          {descricaoLw && <p className="max-w-[220px] text-[11px] text-slate-500">{descricaoLw}</p>}
          {/* A LW nao confirma um formato fixo pra "validado"/"rejeitado" nesse
              retorno (nunca testado contra um caso real) — por isso e a
              pessoa que le a descricao acima quem classifica, em vez do
              sistema adivinhar sozinho. */}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => handleMarcarResultado("VALIDADA")}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            >
              <CheckCircle2 className="h-3 w-3" /> Marcar validado
            </button>
            <button
              type="button"
              onClick={() => handleMarcarResultado("REJEITADA")}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              <XCircle className="h-3 w-3" /> Marcar rejeitado
            </button>
          </div>
        </>
      )}

      {error && <p className="max-w-[220px] text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
