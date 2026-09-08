"use client";

import { FileSpreadsheet, FileText, Table2 } from "lucide-react";
import type { MotoristasFilters } from "@/lib/motoristasList";

function buildQuery(filters: MotoristasFilters, formato: "xlsx" | "csv" | "pdf"): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.escala) params.set("escala", filters.escala);
  if (filters.cnhStatus) params.set("cnhStatus", filters.cnhStatus);
  for (const v of filters.sindicatoId) params.append("sindicatoId", v);
  for (const v of filters.empregador) params.append("empregador", v);
  for (const v of filters.departamento) params.append("departamento", v);
  for (const v of filters.cargo) params.append("cargo", v);
  params.set("formato", formato);
  return params.toString();
}

// Mesmos filtros aplicados na tela (Filtrar) - exporta exatamente a lista
// que esta sendo vista, nao o cadastro inteiro.
export default function MotoristasExportBar({ searchParams }: { searchParams: MotoristasFilters }) {
  const href = (formato: "xlsx" | "csv" | "pdf") => `/api/cadastros/motoristas/exportar?${buildQuery(searchParams, formato)}`;

  return (
    <div className="flex items-center gap-2">
      <a
        href={href("xlsx")}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <FileSpreadsheet className="h-4 w-4" /> Excel
      </a>
      <a
        href={href("csv")}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <Table2 className="h-4 w-4" /> CSV
      </a>
      <a
        href={href("pdf")}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <FileText className="h-4 w-4" /> PDF
      </a>
    </div>
  );
}
