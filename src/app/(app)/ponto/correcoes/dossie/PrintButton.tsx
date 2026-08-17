"use client";

import { Printer } from "lucide-react";
import { primaryButtonClass } from "@/lib/ui";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      data-print-hide
      className={`${primaryButtonClass} inline-flex items-center gap-2`}
    >
      <Printer className="h-4 w-4" /> Imprimir / salvar PDF
    </button>
  );
}
