"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { inputClass } from "@/lib/ui";

export type PassivoDriverRow = {
  driverId: string;
  driverName: string;
  monthlyLabels: string[];
  totalLabel: string;
  tier: "alto" | "medio" | "normal";
};

const TIER_TEXT_CLASS: Record<"alto" | "medio" | "normal", string> = {
  alto: "text-red-600",
  medio: "text-amber-600",
  normal: "text-slate-800",
};

// Mesma normalizacao (remove acentos) ja usada em AnnualDriverTable.tsx /
// MonthlyDriverTable.tsx.
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export default function PassivoDriverTable({
  rows,
  gridTemplateColumns,
}: {
  rows: PassivoDriverRow[];
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
          {trimmed ? "Nenhum motorista encontrado com esse nome." : "Nenhum passivo estimado na janela analisada."}
        </p>
      )}
      {filtered.map((r) => {
        const tierClass = TIER_TEXT_CLASS[r.tier];
        return (
          <div
            key={r.driverId}
            style={{ gridTemplateColumns }}
            className="grid items-center gap-2 border-b border-slate-100 px-4 py-3 last:border-0"
          >
            <span className={`text-sm font-medium ${tierClass}`}>{r.driverName}</span>
            {r.monthlyLabels.map((label, i) => (
              <span key={i} className="text-right text-sm text-slate-600">
                {label}
              </span>
            ))}
            <span className={`text-right text-sm font-semibold ${tierClass}`}>{r.totalLabel}</span>
          </div>
        );
      })}
    </div>
  );
}
