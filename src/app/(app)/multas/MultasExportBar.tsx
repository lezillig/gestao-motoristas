"use client";

import { FileSpreadsheet, FileText, Table2 } from "lucide-react";
import type { MultasFilters, MultaSortField } from "@/lib/multasList";

function buildQuery(filters: MultasFilters & { sort: MultaSortField; dir: "asc" | "desc" }, formato: "xlsx" | "csv" | "pdf"): string {
  const params = new URLSearchParams();
  for (const v of filters.situacaoLw) params.append("situacaoLw", v);
  for (const v of filters.indicacaoStatus) params.append("indicacaoStatus", v);
  for (const v of filters.vehicleId) params.append("vehicleId", v);
  for (const v of filters.driverId) params.append("driverId", v);
  params.set("sort", filters.sort);
  params.set("dir", filters.dir);
  params.set("formato", formato);
  return params.toString();
}

// Mesmos filtros/ordenacao aplicados na tela — exporta exatamente a lista
// que esta sendo vista, mesmo padrao de MotoristasExportBar.tsx.
export default function MultasExportBar({
  searchParams,
}: {
  searchParams: MultasFilters & { sort: MultaSortField; dir: "asc" | "desc" };
}) {
  const href = (formato: "xlsx" | "csv" | "pdf") => `/api/multas/exportar?${buildQuery(searchParams, formato)}`;

  return (
    <div className="flex items-center gap-2">
      <a href={href("xlsx")} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <FileSpreadsheet className="h-4 w-4" /> Excel
      </a>
      <a href={href("csv")} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <Table2 className="h-4 w-4" /> CSV
      </a>
      <a href={href("pdf")} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <FileText className="h-4 w-4" /> PDF
      </a>
    </div>
  );
}
