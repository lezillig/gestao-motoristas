"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, AlertTriangle, Loader2, Search } from "lucide-react";
import { secondaryButtonClass } from "@/lib/ui";
import { checkDeepGaps } from "./actions";
import type { AllGapChecks, GapCheck } from "@/lib/integrationGaps";

function GapRow({ label, check }: { label: string; check: GapCheck }) {
  return (
    <li className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-xs">
      {check.missingDays.length === 0 ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-700">{label}</p>
        <p className="text-slate-500">
          Última importação: {check.lastDate ? format(check.lastDate, "dd/MM/yyyy") : "nunca"}
        </p>
        {check.missingDays.length > 0 && (
          <p className="mt-0.5 text-amber-700">
            {check.missingDays.length} dia(s) sem dado:{" "}
            {check.missingDays.map((d) => format(new Date(`${d}T00:00:00`), "dd/MM")).join(", ")}
          </p>
        )}
      </div>
    </li>
  );
}

// Painel de "desde quando estamos sem dado" por sistema — a checagem
// automatica (toda visita) so olha os ultimos 7 dias, barato o bastante
// pra rodar sempre; os ultimos 60 dias so sao varridos quando o usuario
// pede explicitamente (botao abaixo), pra nao repetir uma consulta mais
// pesada em toda visita a pagina sem necessidade.
export default function GapStatusPanel({ initial }: { initial: AllGapChecks }) {
  const [gaps, setGaps] = useState<AllGapChecks>(initial);
  const [windowLabel, setWindowLabel] = useState("últimos 7 dias");
  const [checking, setChecking] = useState(false);

  async function handleDeepCheck() {
    setChecking(true);
    try {
      const result = await checkDeepGaps();
      setGaps(result);
      setWindowLabel("últimos 60 dias");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Última importação e lacunas ({windowLabel})</p>
          <p className="text-xs text-slate-500">
            Dias sem nenhum dado da fonte — pode indicar uma sincronização que falhou.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDeepCheck}
          disabled={checking}
          className={`${secondaryButtonClass} inline-flex items-center gap-1.5 text-xs disabled:opacity-60`}
        >
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {checking ? "Verificando..." : "Verificar últimos 60 dias"}
        </button>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <GapRow label="TiqueTaque — Ponto" check={gaps.tiquetaquePonto} />
        <GapRow label="SIAT — Escalas" check={gaps.siat} />
        <GapRow label="Sofit — Combustível" check={gaps.sofit} />
        <GapRow label="Ituran — Viagens" check={gaps.ituran} />
      </ul>
    </div>
  );
}
