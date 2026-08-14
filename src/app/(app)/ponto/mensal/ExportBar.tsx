"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, Table2 } from "lucide-react";

export default function ExportBar({ mes }: { mes: string }) {
  const [detalhe, setDetalhe] = useState(false);

  const href = (formato: "xlsx" | "csv" | "pdf") =>
    `/api/ponto/mensal/exportar?mes=${mes}&formato=${formato}&detalhe=${detalhe ? "1" : "0"}`;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={detalhe}
          onChange={(e) => setDetalhe(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Incluir detalhe diário
      </label>
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
    </div>
  );
}
