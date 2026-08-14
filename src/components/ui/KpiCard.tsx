"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cardClass } from "@/lib/ui";

export type KpiDetailRow = { id: string; href?: string; cells: string[] };

export default function KpiCard({
  icon,
  iconBgClass,
  value,
  label,
  columns,
  rows,
  emptyMessage,
}: {
  icon: ReactNode;
  iconBgClass: string;
  value: number;
  label: string;
  columns: string[];
  rows: KpiDetailRow[];
  emptyMessage: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onDoubleClick={() => setOpen(true)}
        title="Duplo clique para ver detalhes"
        className={`${cardClass} w-full cursor-pointer select-none text-left`}
      >
        <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${iconBgClass}`}>
          {icon}
        </div>
        <p className="text-2xl font-semibold text-slate-900">{value}</p>
        <p className="mt-0.5 text-xs text-slate-500">{label}</p>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <p className="text-sm font-semibold text-slate-800">{label}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto">
              {rows.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-slate-500">{emptyMessage}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      {columns.map((c) => (
                        <th key={c} className="px-4 py-2">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        {row.cells.map((cell, i) =>
                          i === 0 && row.href ? (
                            <td key={i} className="px-4 py-2">
                              <Link href={row.href} className="font-medium text-blue-600 hover:underline">
                                {cell}
                              </Link>
                            </td>
                          ) : (
                            <td key={i} className="px-4 py-2 text-slate-600">
                              {cell}
                            </td>
                          )
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
