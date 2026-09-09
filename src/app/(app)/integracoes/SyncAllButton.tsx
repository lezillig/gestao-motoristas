"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, AlertTriangle, Circle, PlayCircle } from "lucide-react";
import { primaryButtonClass } from "@/lib/ui";
import { prepareTiqueTaqueImport, importDriverFromTiqueTaque } from "../ponto/actions";
import { prepareLeaveImport, importLeavesForDriver } from "../afastamentos/actions";
import { syncFromSiat } from "../escalas/siatActions";
import { syncSofitFuel } from "../combustivel/sofitActions";
import { syncAnpPrices } from "../combustivel/actions";
import { syncTicketLogCardStatuses } from "../combustivel/cartoes/actions";
import { sleep, TIQUETAQUE_IMPORT_PACE_MS } from "@/lib/tiquetaque/pace";

type SystemKey = "tiquetaquePonto" | "tiquetaqueAfastamentos" | "siat" | "sofit" | "ticketlog" | "anp";
type SystemStatus = "idle" | "running" | "done" | "error" | "indisponivel";
type SystemState = { status: SystemStatus; message?: string; progress?: { done: number; total: number } };

const LABELS: Record<SystemKey, string> = {
  tiquetaquePonto: "TiqueTaque — Ponto/funcionários",
  tiquetaqueAfastamentos: "TiqueTaque — Afastamentos",
  siat: "SIAT — Escalas",
  sofit: "Sofit — Combustível",
  ticketlog: "Ticket Log — Cartões",
  anp: "ANP — Preços de referência",
};

const ORDER: SystemKey[] = ["tiquetaquePonto", "tiquetaqueAfastamentos", "siat", "sofit", "ticketlog", "anp"];

function StatusIcon({ status }: { status: SystemStatus }) {
  if (status === "running") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />;
  if (status === "done") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />;
  if (status === "error") return <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />;
  if (status === "indisponivel") return <Circle className="h-4 w-4 shrink-0 text-slate-300" />;
  return <Circle className="h-4 w-4 shrink-0 text-slate-300" />;
}

// Dispara os 6 fluxos de sincronização manual que hoje só existiam como
// botões separados. TiqueTaque (ponto e afastamentos) precisa rodar em
// SEQUÊNCIA entre si — os dois fazem 1 chamada por motorista com pausa de
// ~1.1s pra respeitar o limite real de 60 req/min da API (ver
// lib/tiquetaque/pace.ts); rodar os dois ao mesmo tempo dobraria a taxa de
// chamadas e estouraria esse limite. Os outros 4 (SIAT, Sofit, Ticket Log,
// ANP) não usam a API do TiqueTaque, então rodam em paralelo com tudo o
// resto sem risco de rate limit cruzado.
//
// Com ~370 motoristas, cada etapa do TiqueTaque leva uns 7min quando
// precisa reprocessar a frota inteira — na pratica, como o padrao e
// sincronizar so desde a ultima vez (intervalo pequeno), a maioria das
// chamadas por motorista nao encontra nada novo e volta rapido, mas o
// tempo total ainda depende do tamanho da frota, nao só do que mudou.
export default function SyncAllButton({
  tiquetaqueAvailable,
  siatAvailable,
  sofitAvailable,
  ticketLogAvailable,
  pontoRange,
  siatRange,
  mesAtual,
}: {
  tiquetaqueAvailable: boolean;
  siatAvailable: boolean;
  sofitAvailable: boolean;
  ticketLogAvailable: boolean;
  pontoRange: { start: string; end: string };
  siatRange: { start: string; end: string };
  mesAtual: string;
}) {
  const [running, setRunning] = useState(false);
  const [states, setStates] = useState<Record<SystemKey, SystemState>>({
    tiquetaquePonto: { status: tiquetaqueAvailable ? "idle" : "indisponivel" },
    tiquetaqueAfastamentos: { status: tiquetaqueAvailable ? "idle" : "indisponivel" },
    siat: { status: siatAvailable ? "idle" : "indisponivel" },
    sofit: { status: sofitAvailable ? "idle" : "indisponivel" },
    ticketlog: { status: ticketLogAvailable ? "idle" : "indisponivel" },
    anp: { status: "idle" },
  });

  function patch(key: SystemKey, patch: Partial<SystemState>) {
    setStates((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function runPacedDriverLoop(
    key: SystemKey,
    plan: { driverId: string; driverName: string; employeeId: string | null; token: string | null }[],
    callDriver: (driverId: string, employeeId: string, token: string) => Promise<{ errors: { message: string }[] }>
  ) {
    let calledOnce = false;
    let ok = 0;
    let errCount = 0;
    for (let i = 0; i < plan.length; i++) {
      const item = plan[i];
      patch(key, { progress: { done: i, total: plan.length } });
      if (!item.employeeId || !item.token) {
        errCount++;
        continue;
      }
      if (calledOnce) await sleep(TIQUETAQUE_IMPORT_PACE_MS);
      calledOnce = true;
      const r = await callDriver(item.driverId, item.employeeId, item.token);
      if (r.errors.length > 0) errCount += r.errors.length;
      else ok++;
    }
    patch(key, { progress: { done: plan.length, total: plan.length } });
    return { ok, errCount };
  }

  async function runTiqueTaquePonto() {
    patch("tiquetaquePonto", { status: "running" });
    try {
      const planResult = await prepareTiqueTaqueImport(pontoRange.start, pontoRange.end);
      if (planResult.error || !planResult.plan) {
        patch("tiquetaquePonto", { status: "error", message: planResult.error ?? "Falha ao preparar." });
        return;
      }
      let created = 0;
      let corrected = 0;
      await runPacedDriverLoop("tiquetaquePonto", planResult.plan, async (driverId, employeeId, token) => {
        const r = await importDriverFromTiqueTaque(driverId, employeeId, token, pontoRange.start, pontoRange.end);
        created += r.created;
        corrected += r.corrected;
        return r;
      });
      patch("tiquetaquePonto", { status: "done", message: `${created} novo(s), ${corrected} corrigido(s).` });
    } catch (e) {
      patch("tiquetaquePonto", { status: "error", message: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  async function runTiqueTaqueAfastamentos() {
    patch("tiquetaqueAfastamentos", { status: "running" });
    try {
      const planResult = await prepareLeaveImport();
      if (planResult.error || !planResult.plan) {
        patch("tiquetaqueAfastamentos", { status: "error", message: planResult.error ?? "Falha ao preparar." });
        return;
      }
      let imported = 0;
      await runPacedDriverLoop("tiquetaqueAfastamentos", planResult.plan, async (driverId, employeeId, token) => {
        const r = await importLeavesForDriver(driverId, employeeId, token);
        imported += r.imported;
        return r;
      });
      patch("tiquetaqueAfastamentos", { status: "done", message: `${imported} registro(s) importado(s)/atualizado(s).` });
    } catch (e) {
      patch("tiquetaqueAfastamentos", { status: "error", message: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  async function runTiqueTaqueSequencial() {
    await runTiqueTaquePonto();
    await runTiqueTaqueAfastamentos();
  }

  async function runSiat() {
    patch("siat", { status: "running" });
    try {
      const r = await syncFromSiat(siatRange.start, siatRange.end);
      patch("siat", {
        status: "done",
        message: `${r.vehicles.created + r.drivers.created + r.escalas.created} novo(s), ${r.vehicles.updated + r.drivers.updated + r.escalas.updated} atualizado(s).`,
      });
    } catch (e) {
      patch("siat", { status: "error", message: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  async function runSofit() {
    patch("sofit", { status: "running" });
    try {
      const r = await syncSofitFuel({});
      if (r.error) patch("sofit", { status: "error", message: r.error });
      else patch("sofit", { status: "done", message: `${r.result?.created ?? 0} novo(s) importado(s).` });
    } catch (e) {
      patch("sofit", { status: "error", message: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  async function runTicketLog() {
    patch("ticketlog", { status: "running" });
    try {
      const r = await syncTicketLogCardStatuses({});
      if (r.error) patch("ticketlog", { status: "error", message: r.error });
      else patch("ticketlog", { status: "done", message: `${r.result?.count ?? 0} cartão(ões) atualizado(s).` });
    } catch (e) {
      patch("ticketlog", { status: "error", message: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  async function runAnp() {
    patch("anp", { status: "running" });
    try {
      const r = await syncAnpPrices(mesAtual, {});
      patch("anp", {
        status: "done",
        message:
          (r.result?.weeksSynced ?? 0) > 0
            ? `${r.result!.weeksSynced} semana(s) sincronizada(s).`
            : "Nenhuma semana nova disponível.",
      });
    } catch (e) {
      patch("anp", { status: "error", message: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  async function handleClick() {
    setRunning(true);
    const tasks: Promise<void>[] = [runAnp()];
    if (sofitAvailable) tasks.push(runSofit());
    if (ticketLogAvailable) tasks.push(runTicketLog());
    if (siatAvailable) tasks.push(runSiat());
    if (tiquetaqueAvailable) tasks.push(runTiqueTaqueSequencial());
    await Promise.allSettled(tasks);
    setRunning(false);
  }

  return (
    <div className="mb-8 rounded-2xl border border-blue-200 bg-blue-50/50 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Sincronizar tudo agora</p>
          <p className="text-xs text-slate-500">
            Dispara os 6 fluxos manuais de uma vez (TiqueTaque, SIAT, Sofit, Ticket Log, ANP). Pode levar alguns
            minutos — o TiqueTaque processa um motorista de cada vez pra respeitar o limite da API dele.
          </p>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={running}
          className={`${primaryButtonClass} inline-flex items-center gap-2 disabled:opacity-60`}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          {running ? "Sincronizando..." : "Sincronizar tudo"}
        </button>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ORDER.map((key) => {
          const s = states[key];
          return (
            <li key={key} className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-xs">
              <StatusIcon status={s.status} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-700">{LABELS[key]}</p>
                {s.status === "indisponivel" && <p className="text-slate-400">Não configurado.</p>}
                {s.status === "running" && s.progress && s.progress.total > 0 && (
                  <p className="text-slate-500">
                    {s.progress.done}/{s.progress.total} motorista(s)…
                  </p>
                )}
                {s.status === "running" && !s.progress && <p className="text-slate-500">Rodando…</p>}
                {s.status === "done" && <p className="text-emerald-700">{s.message}</p>}
                {s.status === "error" && <p className="text-red-600">{s.message}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
