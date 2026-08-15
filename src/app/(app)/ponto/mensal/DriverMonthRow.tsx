"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export type DayMarcacaoView = { entrada: string; saida: string | null; duracaoLabel: string };
export type DayIntervaloView = { inicio: string; fim: string; duracaoLabel: string };
export type DayCellView = {
  dayKey: string;
  label: string;
  dateLabel: string;
  value: string;
  hasEntry: boolean;
  overtime: boolean;
  interjornadaViolation: boolean;
  missingInterval: boolean;
  workedLabel: string;
  overtimeLabel: string;
  marcacoes: DayMarcacaoView[];
  intervalos: DayIntervaloView[];
} | null;
export type WeekStripView = { label: string; subtotal: string; days: DayCellView[] };

const TIER_TEXT_CLASS: Record<"alto" | "medio" | "normal", string> = {
  alto: "text-red-600",
  medio: "text-amber-600",
  normal: "text-slate-800",
};

export default function DriverMonthRow({
  driverName,
  totalLabel,
  dailyLimitLabel,
  weekTotals,
  gridTemplateColumns,
  weeks,
  tier,
}: {
  driverName: string;
  totalLabel: string;
  // Limite diario (escala/regime do motorista) usado pro card de hora extra
  // no drill-down por dia — mesmo valor pra todos os dias do motorista.
  dailyLimitLabel: string;
  // Total de cada semana do mes, na mesma ordem de `weeks" — resumo visivel
  // na linha, sem precisar abrir o drill on/off pra ver o detalhamento
  // diario.
  weekTotals: string[];
  gridTemplateColumns: string;
  weeks: WeekStripView[];
  // Faixa de risco por hora extra no mes (ranking fixo, calculado na
  // pagina): 20% com mais hora extra = alto, proximos 40% = medio.
  tier: "alto" | "medio" | "normal";
}) {
  const [open, setOpen] = useState(false);
  // So um dia aberto por vez, em qualquer semana do motorista — mesmo
  // espirito do drill on/off por motorista, um nivel abaixo.
  const [openDayKey, setOpenDayKey] = useState<string | null>(null);
  const tierClass = TIER_TEXT_CLASS[tier];

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
        <span className={`text-sm font-medium ${tierClass}`}>{driverName}</span>
        {weekTotals.map((t, i) => (
          <span key={i} className="text-right text-sm text-slate-600">
            {t}
          </span>
        ))}
        <span className={`text-right text-sm font-semibold ${tierClass}`}>{totalLabel}</span>
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
                  const dayOpen = openDayKey === day.dayKey;
                  const baseClass = `mt-1 w-full rounded-md px-1 py-1.5 text-xs font-medium ${
                    !day.hasEntry
                      ? "border border-dashed border-slate-200 text-slate-300"
                      : day.overtime
                        ? "bg-amber-50 text-amber-800"
                        : "bg-blue-50 text-blue-800"
                  } ${violated ? "ring-2 ring-red-400" : dayOpen ? "ring-2 ring-blue-400" : ""}`;
                  return (
                    <div key={i} className="text-center">
                      <p className="text-[10px] uppercase text-slate-400">{day.label}</p>
                      {day.hasEntry ? (
                        <button
                          type="button"
                          title={issues.join(" · ") || undefined}
                          onClick={() => setOpenDayKey(dayOpen ? null : day.dayKey)}
                          className={baseClass}
                        >
                          {day.value}
                        </button>
                      ) : (
                        <p className={baseClass}>{day.value}</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {(() => {
                const openDay = week.days.find((d) => d?.dayKey === openDayKey);
                if (!openDay) return null;
                return (
                  <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                    <p className="mb-2 text-xs font-medium capitalize text-slate-700">{openDay.dateLabel}</p>
                    <table className="w-full overflow-hidden rounded-md border border-blue-100 bg-white text-xs">
                      <tbody>
                        {openDay.marcacoes.map((m, mi) => (
                          <tr key={mi} className="border-b border-blue-50 last:border-0">
                            <td className="px-2.5 py-1.5 text-slate-500">Marcação {mi + 1}</td>
                            <td className="px-2.5 py-1.5 text-right font-medium text-slate-800">
                              {m.entrada} → {m.saida ?? "em aberto"}
                            </td>
                            <td className="px-2.5 py-1.5 text-right text-slate-500">{m.duracaoLabel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {openDay.intervalos.length > 0 && (
                      <div className="mt-2 rounded-md border border-slate-200 bg-white p-2">
                        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          {openDay.intervalos.length > 1 ? "Intervalos" : "Intervalo (almoço)"}
                        </p>
                        <table className="w-full text-xs">
                          <tbody>
                            {openDay.intervalos.map((intervalo, ii) => (
                              <tr key={ii} className="border-b border-slate-50 last:border-0">
                                <td className="py-1 text-slate-500">
                                  {openDay.intervalos.length > 1 ? `Intervalo ${ii + 1}` : "Almoço"}
                                </td>
                                <td className="py-1 text-right font-medium text-slate-800">
                                  {intervalo.inicio} → {intervalo.fim}
                                </td>
                                <td className="py-1 pl-2.5 text-right text-slate-500">{intervalo.duracaoLabel}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="mt-2 flex gap-2">
                      <div className="flex-1 rounded-md border border-blue-100 bg-white px-2.5 py-1.5">
                        <p className="text-[10px] text-slate-500">Total trabalhado no dia</p>
                        <p className="text-sm font-medium text-slate-800">{openDay.workedLabel}</p>
                      </div>
                      <div className="flex-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5">
                        <p className="text-[10px] text-amber-800">Horas extras no dia (escala: {dailyLimitLabel})</p>
                        <p className="text-sm font-medium text-amber-800">{openDay.overtimeLabel}</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
