"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronRight, GripVertical, X } from "lucide-react";
import { badgeClass } from "@/lib/ui";
import { COLUMN_LABELS, DEFAULT_COLUMN_ORDER, type ColumnKey, type PontoEscalaRow } from "./types";

const STORAGE_KEY = "pontoEscala.layout.v1";

function formatDiff(diff: number | null): string {
  if (diff === null) return "—";
  if (diff === 0) return "no horário";
  return diff > 0 ? `+${diff}min` : `${diff}min`;
}

function rowKey(row: PontoEscalaRow): string {
  return `${row.driverId}_${row.dateISO}`;
}

function cellValue(row: PontoEscalaRow, col: ColumnKey): string | number {
  switch (col) {
    case "motorista":
      return row.driverName;
    case "data":
      return row.dateISO;
    case "inicioSiat":
      return row.startScheduled ?? "";
    case "inicioPonto":
      return row.startActual ?? "";
    case "diffInicio":
      return row.startDiff ?? Number.NEGATIVE_INFINITY;
    case "fimSiat":
      return row.endScheduled ?? "";
    case "fimPonto":
      return row.endActual ?? "";
    case "diffFim":
      return row.endDiff ?? Number.NEGATIVE_INFINITY;
  }
}

export default function PontoEscalaTable({ rows, tolerancia }: { rows: PontoEscalaRow[]; tolerancia: number }) {
  const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMN_ORDER);
  const [groupBy, setGroupBy] = useState<ColumnKey | null>(null);
  const [sortField, setSortField] = useState<ColumnKey>("data");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [dragging, setDragging] = useState<ColumnKey | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<ColumnKey | "grupo" | null>(null);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  // Layout (ordem das colunas + agrupamento) e conveniencia por navegador,
  // nao dado de negocio — persistido so localmente, cada usuario mantem o
  // proprio arranjo (mesma logica de qualquer tabela dinamica tipo Excel).
  // Le localStorage so depois de montar (nunca no initializer do useState) de
  // proposito — o servidor nao tem localStorage, entao ler antes da
  // hidratacao faria o HTML do cliente divergir do servidor (mismatch).
  // Hidratacao unica de layout salvo, nao uma cascata de renders.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { columns?: ColumnKey[]; groupBy?: ColumnKey | null };
        if (Array.isArray(saved.columns) && saved.columns.length === DEFAULT_COLUMN_ORDER.length) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setColumns(saved.columns);
        }
        if (saved.groupBy !== undefined) setGroupBy(saved.groupBy);
      }
    } catch {
      // localStorage indisponivel (aba privada, etc.) — segue com o layout padrao
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns, groupBy }));
    } catch {
      // ignora — layout so nao persiste entre sessoes
    }
  }, [columns, groupBy, hydrated]);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = cellValue(a, sortField);
      const vb = cellValue(b, sortField);
      const cmp =
        typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortField, sortDir]);

  const groups = useMemo(() => {
    if (!groupBy) return null;
    const map = new Map<string, PontoEscalaRow[]>();
    for (const row of sortedRows) {
      const raw = cellValue(row, groupBy);
      const key = groupBy === "data" ? format(parseISO(row.dateISO), "dd/MM/yyyy") : String(raw || "—");
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [sortedRows, groupBy]);

  function handleHeaderClick(col: ColumnKey) {
    if (sortField === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(col);
      setSortDir("asc");
    }
  }

  function handleDropOnColumn(target: ColumnKey) {
    setDragOverTarget(null);
    if (!dragging || dragging === target) return;
    setColumns((cols) => {
      const next = cols.filter((c) => c !== dragging);
      const idx = next.indexOf(target);
      next.splice(idx, 0, dragging);
      return next;
    });
    setDragging(null);
  }

  function handleDropOnGroupZone() {
    setDragOverTarget(null);
    if (!dragging) return;
    setGroupBy(dragging);
    setDragging(null);
  }

  function toggleRow(key: string) {
    setOpenRows((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderCell(row: PontoEscalaRow, col: ColumnKey) {
    const atrasado = row.startDiff !== null && row.startDiff > tolerancia;
    const saidaCedo = row.endDiff !== null && row.endDiff < -tolerancia;
    switch (col) {
      case "motorista":
        return (
          <span className="line-clamp-2 max-w-[160px] font-medium text-slate-800" title={row.driverName}>
            {row.driverName}
          </span>
        );
      case "data":
        return <span className="whitespace-nowrap text-slate-600">{format(parseISO(row.dateISO), "dd/MM/yyyy")}</span>;
      case "inicioSiat":
        return <span className="whitespace-nowrap text-slate-600">{row.startScheduled ?? "—"}</span>;
      case "inicioPonto":
        return <span className="whitespace-nowrap text-slate-800">{row.startActual ?? "—"}</span>;
      case "diffInicio":
        return row.startDiff === null ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <span className={`${badgeClass} ${atrasado ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
            {formatDiff(row.startDiff)}
          </span>
        );
      case "fimSiat":
        return <span className="whitespace-nowrap text-slate-600">{row.endScheduled ?? "—"}</span>;
      case "fimPonto":
        return <span className="whitespace-nowrap text-slate-800">{row.endActual ?? "—"}</span>;
      case "diffFim":
        return row.endDiff === null ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <span className={`${badgeClass} ${saidaCedo ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
            {formatDiff(row.endDiff)}
          </span>
        );
    }
  }

  function renderRow(row: PontoEscalaRow) {
    const key = rowKey(row);
    const open = openRows.has(key);
    return (
      <Fragment key={key}>
        <tr
          className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
          onClick={() => toggleRow(key)}
        >
          <td className="px-2 py-3 text-slate-400">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </td>
          {columns.map((col) => (
            <td key={col} className="whitespace-nowrap px-4 py-3 text-xs">
              {renderCell(row, col)}
            </td>
          ))}
        </tr>
        {open && (
          <tr className="border-b border-slate-100 bg-slate-50 last:border-0">
            <td />
            <td colSpan={columns.length} className="px-4 py-3 text-xs text-slate-600">
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <p className="mb-1 font-medium text-slate-500">Reserva(s) do dia no SIAT</p>
                  {row.escalas.length === 0 ? (
                    <p className="text-slate-400">Nenhuma reserva no SIAT nesse dia.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {row.escalas.map((e) => (
                        <li key={e.id}>
                          {e.startTime || "(sem horário de início)"} – {e.endTime ?? "sem horário de fim"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {(row.intervaloInicio || row.intervaloFim) && (
                  <div>
                    <p className="mb-1 font-medium text-slate-500">Intervalo</p>
                    <p>
                      {row.intervaloInicio ?? "—"} – {row.intervaloFim ?? "—"}
                    </p>
                  </div>
                )}
                <div className="flex items-end">
                  {row.entryId ? (
                    <Link href={`/ponto/${row.entryId}`} className="text-xs font-medium text-blue-700 hover:underline">
                      Ver/editar registro de ponto
                    </Link>
                  ) : (
                    <span className="text-slate-400">Sem registro de ponto nesse dia.</span>
                  )}
                </div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverTarget("grupo");
        }}
        onDragLeave={() => setDragOverTarget((t) => (t === "grupo" ? null : t))}
        onDrop={handleDropOnGroupZone}
        className={`flex min-h-[44px] flex-wrap items-center gap-2 rounded-lg border-2 border-dashed px-3 py-2 text-xs transition-colors ${
          dragOverTarget === "grupo" ? "border-blue-400 bg-blue-50" : groupBy ? "border-blue-200 bg-blue-50/40" : "border-slate-200 bg-slate-50"
        }`}
      >
        <span className="font-medium text-slate-500">Agrupar por:</span>
        {groupBy ? (
          <span className={`${badgeClass} bg-blue-100 text-blue-700`}>
            {COLUMN_LABELS[groupBy]}
            <button
              type="button"
              onClick={() => setGroupBy(null)}
              className="ml-1.5 inline-flex items-center rounded-full hover:bg-blue-200"
              aria-label="Remover agrupamento"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : (
          <span className="text-slate-400">arraste um cabeçalho de coluna pra cá pra agrupar (ex.: Motorista, Data)</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <th className="w-8 px-2 py-3" />
              {columns.map((col) => (
                <th
                  key={col}
                  draggable
                  onDragStart={() => setDragging(col)}
                  onDragEnd={() => {
                    setDragging(null);
                    setDragOverTarget(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverTarget(col);
                  }}
                  onDragLeave={() => setDragOverTarget((t) => (t === col ? null : t))}
                  onDrop={() => handleDropOnColumn(col)}
                  onClick={() => handleHeaderClick(col)}
                  className={`cursor-move select-none whitespace-nowrap px-4 py-3 transition-colors hover:bg-slate-100 ${
                    dragOverTarget === col ? "bg-blue-100" : ""
                  } ${dragging === col ? "opacity-40" : ""}`}
                  title="Arraste pra reordenar (ou soltar em &quot;Agrupar por&quot;) — clique pra ordenar"
                >
                  <span className="inline-flex items-center gap-1">
                    <GripVertical className="h-3 w-3 shrink-0 text-slate-300" />
                    {COLUMN_LABELS[col]}
                    {sortField === col && <span className="text-slate-400">{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-slate-500">
                  Nenhum dia com escala ou ponto batido neste período.
                </td>
              </tr>
            )}
            {!groupBy && sortedRows.map((row) => renderRow(row))}
            {groupBy &&
              groups!.map(([key, groupRows]) => (
                <Fragment key={key}>
                  <tr className="bg-slate-100">
                    <td colSpan={columns.length + 1} className="px-4 py-2 text-xs font-semibold text-slate-600">
                      {COLUMN_LABELS[groupBy]}: {key} · {groupRows.length} registro(s)
                    </td>
                  </tr>
                  {groupRows.map((row) => renderRow(row))}
                </Fragment>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
