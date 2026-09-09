"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, AlertTriangle, Loader2, Search, DownloadCloud } from "lucide-react";
import { secondaryButtonClass } from "@/lib/ui";
import { checkDeepGaps, checkGapsFor } from "./actions";
import { prepareTiqueTaqueImport, importDriverFromTiqueTaque } from "../ponto/actions";
import { syncFromSiat } from "../escalas/siatActions";
import { backfillSofitFuel } from "../combustivel/sofitActions";
import { backfillIturanTrips } from "../telemetria/actions";
import { sleep, TIQUETAQUE_IMPORT_PACE_MS } from "@/lib/tiquetaque/pace";
import { RECURRING_GAP_WINDOW_DAYS, DEEP_GAP_WINDOW_DAYS, type AllGapChecks, type GapCheck } from "@/lib/integrationGaps";

type SystemKey = keyof AllGapChecks;
type ImportState = { status: "idle" | "running" | "done" | "error"; message?: string; progress?: { done: number; total: number } };

function minMax(days: string[]): { min: string; max: string } | null {
  if (days.length === 0) return null;
  const sorted = [...days].sort();
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

function GapRow({
  label,
  check,
  importState,
  onImport,
}: {
  label: string;
  check: GapCheck;
  importState: ImportState;
  onImport: () => void;
}) {
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
          <>
            <p className="mt-0.5 text-amber-700">
              {check.missingDays.length} dia(s) sem dado:{" "}
              {check.missingDays.map((d) => format(new Date(`${d}T00:00:00`), "dd/MM")).join(", ")}
            </p>
            {/* Mensagem do ultimo import fica visivel MESMO com o botao —
                se a lacuna nao fechou de vez (ex.: Sofit com hasMore),
                precisa poder clicar de novo sem recarregar a pagina. */}
            {importState.status === "done" && <p className="mt-1 text-emerald-700">{importState.message}</p>}
            {importState.status === "error" && <p className="mt-1 text-red-600">{importState.message}</p>}
            <button
              type="button"
              onClick={onImport}
              disabled={importState.status === "running"}
              className={`${secondaryButtonClass} mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 text-[11px] disabled:opacity-60`}
            >
              {importState.status === "running" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <DownloadCloud className="h-3 w-3" />
              )}
              {importState.status === "running"
                ? importState.progress
                  ? `Importando... ${importState.progress.done}/${importState.progress.total}`
                  : "Importando..."
                : "Importar todas datas faltantes"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// Painel de "desde quando estamos sem dado" por sistema — a checagem
// automatica (toda visita) so olha os ultimos 7 dias, barato o bastante
// pra rodar sempre; os ultimos 60 dias so sao varridos quando o usuario
// pede explicitamente (botao abaixo), pra nao repetir uma consulta mais
// pesada em toda visita a pagina sem necessidade. Cada lacuna encontrada
// pode ser reimportada na hora (min/max dos dias faltantes vira o
// intervalo pedido pra cada sistema) — sem isso, o usuario teria que ir em
// cada tela e montar esse intervalo manualmente.
export default function GapStatusPanel({ initial }: { initial: AllGapChecks }) {
  const [gaps, setGaps] = useState<AllGapChecks>(initial);
  const [windowDays, setWindowDays] = useState(RECURRING_GAP_WINDOW_DAYS);
  const [checking, setChecking] = useState(false);
  const [imports, setImports] = useState<Record<SystemKey, ImportState>>({
    tiquetaquePonto: { status: "idle" },
    siat: { status: "idle" },
    sofit: { status: "idle" },
    ituran: { status: "idle" },
  });

  function patchImport(key: SystemKey, patch: Partial<ImportState>) {
    setImports((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  // Reconfere so ESSE sistema, na mesma janela que estava sendo exibida —
  // sem isso, depois de um "Importar todas datas faltantes" bem-sucedido a
  // lacuna corrigida continuava aparecendo na tela (o `gaps` state so era
  // atualizado pelas duas checagens manuais, nunca depois de um import).
  async function refreshGapsFor(key: SystemKey) {
    const fresh = await checkGapsFor(key, windowDays);
    setGaps((prev) => ({ ...prev, [key]: fresh }));
  }

  async function handleDeepCheck() {
    setChecking(true);
    try {
      const result = await checkDeepGaps();
      setGaps(result);
      setWindowDays(DEEP_GAP_WINDOW_DAYS);
    } finally {
      setChecking(false);
    }
  }

  async function importTiqueTaquePonto() {
    const range = minMax(gaps.tiquetaquePonto.missingDays);
    if (!range) return;
    patchImport("tiquetaquePonto", { status: "running" });
    try {
      const planResult = await prepareTiqueTaqueImport(range.min, range.max);
      if (planResult.error || !planResult.plan) {
        patchImport("tiquetaquePonto", { status: "error", message: planResult.error ?? "Falha ao preparar." });
        return;
      }
      const plan = planResult.plan;
      let created = 0;
      let corrected = 0;
      let calledOnce = false;
      for (let i = 0; i < plan.length; i++) {
        const item = plan[i];
        patchImport("tiquetaquePonto", { progress: { done: i, total: plan.length } });
        if (!item.employeeId || !item.token) continue;
        if (calledOnce) await sleep(TIQUETAQUE_IMPORT_PACE_MS);
        calledOnce = true;
        const r = await importDriverFromTiqueTaque(item.driverId, item.employeeId, item.token, range.min, range.max);
        created += r.created;
        corrected += r.corrected;
      }
      patchImport("tiquetaquePonto", { status: "done", message: `${created} novo(s), ${corrected} corrigido(s).` });
      await refreshGapsFor("tiquetaquePonto");
    } catch (e) {
      patchImport("tiquetaquePonto", { status: "error", message: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  async function importSiat() {
    const range = minMax(gaps.siat.missingDays);
    if (!range) return;
    patchImport("siat", { status: "running" });
    try {
      const r = await syncFromSiat(range.min, range.max);
      patchImport("siat", {
        status: "done",
        message: `${r.vehicles.created + r.drivers.created + r.escalas.created} novo(s), ${r.vehicles.updated + r.drivers.updated + r.escalas.updated} atualizado(s).`,
      });
      await refreshGapsFor("siat");
    } catch (e) {
      patchImport("siat", { status: "error", message: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  async function importSofit() {
    const range = minMax(gaps.sofit.missingDays);
    if (!range) return;
    patchImport("sofit", { status: "running" });
    try {
      const r = await backfillSofitFuel(range.min);
      if (r.error) {
        patchImport("sofit", { status: "error", message: r.error });
      } else {
        patchImport("sofit", {
          status: "done",
          message: `${r.result?.created ?? 0} novo(s) importado(s).${r.result?.hasMore ? " Ainda tem período mais antigo — clique de novo depois." : ""}`,
        });
        await refreshGapsFor("sofit");
      }
    } catch (e) {
      patchImport("sofit", { status: "error", message: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  async function importIturan() {
    const range = minMax(gaps.ituran.missingDays);
    if (!range) return;
    patchImport("ituran", { status: "running" });
    try {
      const r = await backfillIturanTrips(range.min, range.max);
      if (r.error) {
        patchImport("ituran", { status: "error", message: r.error });
      } else {
        patchImport("ituran", { status: "done", message: `${r.result?.upserted ?? 0} viagem(ns) importada(s)/atualizada(s).` });
        await refreshGapsFor("ituran");
      }
    } catch (e) {
      patchImport("ituran", { status: "error", message: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  return (
    <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Última importação e lacunas (últimos {windowDays} dias)</p>
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
        <GapRow label="TiqueTaque — Ponto" check={gaps.tiquetaquePonto} importState={imports.tiquetaquePonto} onImport={importTiqueTaquePonto} />
        <GapRow label="SIAT — Escalas" check={gaps.siat} importState={imports.siat} onImport={importSiat} />
        <GapRow label="Sofit — Combustível" check={gaps.sofit} importState={imports.sofit} onImport={importSofit} />
        <GapRow label="Ituran — Viagens" check={gaps.ituran} importState={imports.ituran} onImport={importIturan} />
      </ul>
    </div>
  );
}
