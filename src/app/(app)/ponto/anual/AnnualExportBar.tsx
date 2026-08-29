"use client";

import { FileSpreadsheet, FileText, Table2 } from "lucide-react";

export default function AnnualExportBar({ ano, visao }: { ano: number; visao: string }) {
  const href = (formato: "xlsx" | "csv" | "pdf") =>
    `/api/ponto/anual/exportar?ano=${ano}&visao=${visao}&formato=${formato}`;

  return (
    <div className="flex gap-2">
      <a
        href={href("xlsx")}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
      </a>
      <a
        href={href("csv")}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <Table2 className="h-3.5 w-3.5" /> CSV
      </a>
      <a
        href={href("pdf")}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <FileText className="h-3.5 w-3.5" /> PDF
      </a>
    </div>
  );
}
