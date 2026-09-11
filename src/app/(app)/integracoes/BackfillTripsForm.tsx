"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, subDays } from "date-fns";
import { Loader2, History } from "lucide-react";
import { inputClass, secondaryButtonClass } from "@/lib/ui";
import { backfillIturanTrips } from "../telemetria/actions";

// Backfill manual por intervalo de data, independente do painel de lacunas
// acima (checkIturanGaps/GapStatusPanel) -- aquele calculo so aponta um dia
// como "faltando" se NENHUM veiculo da empresa tiver viagem registrada
// nesse dia, entao um veiculo especifico sem sincronizacao (ex.: cadastrado
// depois que a rotina diaria ja tinha processado aquele periodo, enquanto
// outros veiculos da frota ja tinham dado naquele mesmo dia) pode ficar sem
// viagem pra sempre sem o painel nunca acusar a lacuna — confirmado real
// 2026-09-11 (frota renovada em 24/08, veiculos novos sem viagem da Ituran
// sincronizada mesmo com a API tendo o dado). Este formulario reimporta o
// intervalo pedido pra frota inteira sem depender desse calculo por dia.
export default function BackfillTripsForm() {
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 14), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const r = await backfillIturanTrips(dateFrom, dateTo);
      if (r.error) setError(r.error);
      else {
        setMessage(
          `${r.result?.upserted ?? 0} viagem(ns) importada(s)/atualizada(s).${
            r.result?.semEscala ? ` ${r.result.semEscala} sem escala correspondente.` : ""
          }`
        );
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao reimportar viagens.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">De</label>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${inputClass} w-36 text-xs`} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Até</label>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${inputClass} w-36 text-xs`} />
      </div>
      <button
        type="submit"
        disabled={loading}
        className={`${secondaryButtonClass} inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] disabled:opacity-60`}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
        Reimportar viagens
      </button>
      {message && <p className="w-full text-xs text-emerald-700">{message}</p>}
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
