"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export type DayCellView = {
  label: string;
  value: string;
  hasEntry: boolean;
  overtime: boolean;
  interjornadaViolation: boolean;
  missingInterval: boolean;
} | null;
export type WeekStripView = { label: string; subtotal: string; days: DayCellView[] };

export default function DriverMonthRow({
  driverName,
  totalLabel,
  weekTotals,
  gridTemplateColumns,
  weeks,
}: {
  driverName: string;
  totalLabel: string;
  // Total de cada semana do mes, na mesma ordem de `weeks" — resumo visivel
  // na linha, sem precisar abrir o drill on/off pra ver o detalhamento
  // diario.
  weekTotals: string[];
  gridTemplateColumns: string;
  weeks: WeekStripView[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ gridTemplateColumns }}
        className={`grid w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50 ${
          open ? "bg-blue-50/50" : ""
        }`}
      >
        <span className="text-sm font-medium text-slate-800">{driverName}</span>
        {weekTotals.map((t, i) => (
          <span key={i} className="text-right text-sm text-slate-600">
            {t}
          </span>
        ))}
        <span className="text-right text-sm font-semibold text-slate-900">{totalLabel}</span>
        <span className="flex justify-end text-slate-400">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-4 pb-4 pl-8">
          {weeks.map((week) => (
            <div key={week.label}>
              <p className="mb-1.5 text-xs font-medium text-slate-500">
                {week.label} · {week.subtotal}
              </p>
              <div className="grid grid-cols-7 gap-1.5">
                {week.days.map((day, i) => {
                  if (!day) return <div key={i} />;
                  const issues = [
                    day.interjornadaViolation && "descanso entre turnos abaixo do mínimo legal",
                    day.missingInterval && "turno de 6h+ sem intervalo intrajornada registrado",
                  ].filter(Boolean) as string[];
                  const violated = issues.length > 0;
                  return (
                    <div key={i} className="text-center">
                      <p className="text-[10px] uppercase text-slate-400">{day.label}</p>
                      <p
                        title={issues.join(" · ") || undefined}
                        className={`mt-1 rounded-md px-1 py-1.5 text-xs font-medium ${
                          !day.hasEntry
                            ? "border border-dashed border-slate-200 text-slate-300"
                            : day.overtime
                              ? "bg-amber-50 text-amber-800"
                              : "bg-blue-50 text-blue-800"
                        } ${violated ? "ring-2 ring-red-400" : ""}`}
                      >
                        {day.value}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
