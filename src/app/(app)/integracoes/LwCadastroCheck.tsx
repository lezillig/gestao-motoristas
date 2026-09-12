"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, ScanSearch } from "lucide-react";
import { badgeClass, secondaryButtonClass } from "@/lib/ui";
import type { LwCadastroConferencia } from "@/lib/lw/sync";
import { conferirCadastrosLwAction } from "./lwActions";

export default function LwCadastroCheck() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LwCadastroConferencia | null>(null);
  const [error, setError] = useState<string | null>(null);

  function conferir() {
    setError(null);
    startTransition(async () => {
      const r = await conferirCadastrosLwAction();
      if (r.error) setError(r.error);
      else setResult(r.result ?? null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={conferir} disabled={pending} className={`${secondaryButtonClass} inline-flex w-fit items-center gap-1.5 text-xs disabled:opacity-60`}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
        {pending ? "Conferindo…" : "Conferir cadastros LW × frota"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {result && (
        <div className="flex flex-col gap-2 text-xs">
          <p className="text-slate-500">
            {result.totalFrota} veículo(s) na frota · {result.totalLw} na LW
          </p>
          <div>
            <p className="font-medium text-slate-700">
              Na frota, sem cadastro na LW{" "}
              <span className={`${badgeClass} ${result.frotaSemLw.length > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                {result.frotaSemLw.length}
              </span>
            </p>
            {result.frotaSemLw.length === 0 ? (
              <p className="mt-0.5 flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> Toda a frota está na LW.
              </p>
            ) : (
              <>
                <p className="mt-0.5 text-slate-500">Multa desses veículos nunca vai chegar aqui até serem cadastrados na LW.</p>
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-slate-50 p-2">
                  {result.frotaSemLw.map((v) => (
                    <li key={v.plate} className="flex justify-between gap-2 py-0.5">
                      <span>
                        <span className="font-mono font-medium">{v.plate}</span> <span className="text-slate-500">{v.modelo}</span>
                      </span>
                      <span className="text-slate-400">{v.status}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div>
            <p className="font-medium text-slate-700">
              Na LW, sem par na frota{" "}
              <span className={`${badgeClass} ${result.lwSemFrota.length > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                {result.lwSemFrota.length}
              </span>
            </p>
            {result.lwSemFrota.length === 0 ? (
              <p className="mt-0.5 flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> Todo veículo da LW bate com um da frota.
              </p>
            ) : (
              <>
                <p className="mt-0.5 text-slate-500">Placa errada de um lado, veículo já vendido/baixado, ou outra empresa no mesmo login da LW.</p>
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-slate-50 p-2">
                  {result.lwSemFrota.map((v) => (
                    <li key={`${v.placa}-${v.placaMercosul ?? ""}`} className="flex justify-between gap-2 py-0.5">
                      <span>
                        <span className="font-mono font-medium">{v.placa}</span>
                        {v.placaMercosul && v.placaMercosul !== v.placa && <span className="font-mono text-slate-400"> / {v.placaMercosul}</span>}{" "}
                        <span className="text-slate-500">{v.modelo ?? ""}</span>
                      </span>
                      <span className="text-slate-400">{v.status ?? ""}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
