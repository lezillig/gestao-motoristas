"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { badgeClass } from "@/lib/ui";

export type BancoHorasMonthView = { label: string; creditLabel: string; debitLabel: string; balanceLabel: string };

export default function BancoHorasDriverRow({
  driverName,
  creditLabel,
  debitLabel,
  balanceLabel,
  positiveBalance,
  atRisk,
  atRiskTitle,
  months,
}: {
  driverName: string;
  creditLabel: string;
  debitLabel: string;
  balanceLabel: string;
  positiveBalance: boolean;
  atRisk: boolean;
  atRiskTitle: string;
  months: BancoHorasMonthView[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="border-b border-slate-100 last:border-0">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`flex items-center gap-1.5 font-medium hover:underline ${
              atRisk ? "text-red-600" : "text-slate-800"
            }`}
          >
            {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
            {driverName}
          </button>
        </td>
        <td className="px-4 py-3 text-right text-slate-600">{creditLabel}</td>
        <td className="px-4 py-3 text-right text-slate-600">{debitLabel}</td>
        <td className={`px-4 py-3 text-right font-medium ${positiveBalance ? "text-amber-700" : "text-slate-600"}`}>
          {balanceLabel}
        </td>
        <td className="px-4 py-3">
          {atRisk && (
            <span className={`${badgeClass} inline-flex items-center gap-1 bg-red-100 text-red-700`} title={atRiskTitle}>
              <AlertTriangle className="h-3 w-3" /> Perto do limite
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-100 last:border-0 bg-slate-50/60">
          <td colSpan={5} className="px-4 py-3 pl-10">
            <table className="w-full max-w-lg text-xs">
              <thead>
                <tr className="text-left uppercase tracking-wide text-slate-400">
                  <th className="py-1 pr-3 font-medium">Mês</th>
                  <th className="py-1 pr-3 text-right font-medium">Crédito</th>
                  <th className="py-1 pr-3 text-right font-medium">Débito</th>
                  <th className="py-1 text-right font-medium">Saldo acumulado</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 capitalize text-slate-600">{m.label}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-600">{m.creditLabel}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-600">{m.debitLabel}</td>
                    <td className="py-1.5 text-right font-medium text-slate-800">{m.balanceLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
