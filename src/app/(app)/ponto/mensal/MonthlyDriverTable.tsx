"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { inputClass } from "@/lib/ui";
import DriverMonthRow, { type WeekStripView } from "./DriverMonthRow";

export type MonthlyDriverRow = {
  driverId: string;
  driverName: string;
  totalLabel: string;
  dailyLimitLabel: string;
  weekTotals: string[];
  weeks: WeekStripView[];
  tier: "alto" | "medio" | "normal";
};

// Remove acentos pra busca funcionar independente de o usuario digitar "Jose"
// ou "José" — nomes reais vem do TiqueTaque sem padrao garantido nesse
// aspecto.
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export default function MonthlyDriverTable({
  rows,
  gridTemplateColumns,
}: {
  rows: MonthlyDriverRow[];
  gridTemplateColumns: string;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const filtered = trimmed ? rows.filter((r) => normalize(r.driverName).includes(normalize(trimmed))) : rows;

  return (
    <div>
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar motorista..."
            className={`${inputClass} pl-9`}
          />
        </div>
      </div>
      {filtered.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-slate-500">
          {trimmed ? "Nenhum motorista encontrado com esse nome." : "Nenhum motorista com hora extra neste mês."}
        </p>
      )}
      {filtered.map((r) => (
        <DriverMonthRow
          key={r.driverId}
          driverName={r.driverName}
          totalLabel={r.totalLabel}
          dailyLimitLabel={r.dailyLimitLabel}
          weekTotals={r.weekTotals}
          gridTemplateColumns={gridTemplateColumns}
          weeks={r.weeks}
          tier={r.tier}
        />
      ))}
    </div>
  );
}
