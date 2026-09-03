"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { AlertTriangle, ChevronDown, ChevronRight, GripVertical, X } from "lucide-react";
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
    case "unidade":
      return row.unidade ?? "";
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

// Versao texto puro (pra exportar) das mesmas colunas de renderCell — evita
// duplicar a logica de formatacao (formatDiff, data BR) numa segunda funcao
// desalinhada da tela.
function cellText(row: PontoEscalaRow, col: ColumnKey): string {
  switch (col) {
    case "motorista":
      return row.driverName;
    case "unidade":
      return row.unidade ?? "—";
    case "data":
      return format(parseISO(row.dateISO), "dd/MM/yyyy");
    case "inicioSiat":
      return (row.startScheduled ?? "—") + (row.startUnreliable ? " (rota fixa, horário não confiável)" : "");
    case "inicioPonto":
      return row.startActual ?? "—";
    case "diffInicio":
      return formatDiff(row.startDiff);
    case "fimSiat":
      return (row.endScheduled ?? "—") + (row.endUnreliable ? " (rota fixa, horário não confiável)" : "");
    case "fimPonto":
      return row.endActual ?? "—";
    case "diffFim":
      return formatDiff(row.endDiff);
  }
}

function csvEscape(value: string): string {
  if (/[",\n;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  const [exporting, setExporting] = useState(false);

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

  // Linha a linha, na mesma ordem/agrupamento que a tela mostra — usado
  // pelas 2 exportacoes (CSV e Excel) pra nao duplicar a logica de
  // "respeita ordenacao e agrupamento atuais" em cada uma.
  function linearizedForExport(): { groupLabel: string | null; row: PontoEscalaRow }[] {
    if (!groupBy) return sortedRows.map((row) => ({ groupLabel: null, row }));
    const out: { groupLabel: string | null; row: PontoEscalaRow }[] = [];
    for (const [key, groupRows] of groups ?? []) {
      for (const row of groupRows) out.push({ groupLabel: key, row });
    }
    return out;
  }

  function exportHeaderAndRows(): { header: string[]; body: string[][] } {
    const header = groupBy ? [`${COLUMN_LABELS[groupBy]} (grupo)`, ...columns.map((c) => COLUMN_LABELS[c])] : columns.map((c) => COLUMN_LABELS[c]);
    const body = linearizedForExport().map(({ groupLabel, row }) =>
      groupBy ? [groupLabel ?? "", ...columns.map((c) => cellText(row, c))] : columns.map((c) => cellText(row, c))
    );
    return { header, body };
  }

  function exportCsv() {
    const { header, body } = exportHeaderAndRows();
    // ; como separador (nao ,) — Excel em pt-BR espera isso por padrao,
    // senao abre tudo numa coluna so.
    const lines = [header, ...body].map((cols) => cols.map(csvEscape).join(";"));
    const csv = "﻿" + lines.join("\r\n"); // BOM: Excel reconhece UTF-8 com acento certo
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `ponto-x-escala-${format(new Date(), "yyyy-MM-dd")}.csv`);
  }

  async function exportXlsx() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Ponto x Escala");
      const { header, body } = exportHeaderAndRows();
      sheet.addRow(header);
      sheet.getRow(1).font = { bold: true };
      for (const row of body) sheet.addRow(row);
      sheet.columns.forEach((col) => {
        col.width = 20;
      });
      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `ponto-x-escala-${format(new Date(), "yyyy-MM-dd")}.xlsx`
      );
    } finally {
      setExporting(false);
    }
  }

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
      case "unidade":
        return (
          <span className="line-clamp-2 max-w-[140px] text-slate-600" title={row.unidade ?? "—"}>
            {row.unidade ?? "—"}
          </span>
        );
      case "data":
        return <span className="whitespace-nowrap text-slate-600">{format(parseISO(row.dateISO), "dd/MM/yyyy")}</span>;
      case "inicioSiat":
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-slate-600">
            {row.startScheduled ?? "—"}
            {row.startUnreliable && (
              <span title='Reserva "fixa" (rota recorrente) — a API do SIAT não traz o horário real dessa rota, só um valor de referência. Não dá pra confiar nessa diferença.'>
                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
              </span>
            )}
          </span>
        );
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
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-slate-600">
            {row.endScheduled ?? "—"}
            {row.endUnreliable && (
              <span title='Reserva "fixa" (rota recorrente) — a API do SIAT não traz o horário real dessa rota, só um valor de referência. Não dá pra confiar nessa diferença.'>
                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
              </span>
            )}
          </span>
        );
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
                          {e.requestType === "fixa" && (
                            <span className="ml-1 text-amber-600">(rota fixa — horário não confiável)</span>
                          )}
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
      <div data-print-hide className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Exportar CSV
        </button>
        <button
          type="button"
          onClick={exportXlsx}
          disabled={exporting}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {exporting ? "Gerando Excel…" : "Exportar Excel"}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Imprimir / salvar PDF
        </button>
      </div>

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

      <div className="overflow-x-auto scroll-visible rounded-2xl border border-slate-200 bg-white">
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
