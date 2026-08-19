"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { parseTiqueTaqueBulkCsv } from "@/lib/tiquetaque/csvImport";
import { importCsvForDriver, type TiqueTaqueImportRowError } from "./actions";
import type { TiqueTaqueDayEntry } from "@/lib/tiquetaque/types";

type Parsed = {
  byDriverName: Map<string, TiqueTaqueDayEntry[]>;
  totalRows: number;
  totalDriverDays: number;
};

type Progress = { done: number; total: number; currentDriverName?: string };

export default function TiqueTaqueCsvImportForm() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<{
    created: number;
    corrected: number;
    errors: TiqueTaqueImportRowError[];
  } | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResult(null);
    setParseError(null);
    setParsed(null);
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const text = new TextDecoder("iso-8859-1").decode(buffer);
      const p = parseTiqueTaqueBulkCsv(text);
      if (p.byDriverName.size === 0) {
        setParseError("Nenhum motorista com marcação encontrado no arquivo — confira se é a exportação em massa do TiqueTaque.");
        return;
      }
      setParsed(p);
    } catch {
      setParseError("Não consegui ler esse arquivo. Confira se é o .csv exportado do TiqueTaque.");
    }
  }

  async function handleConfirm() {
    if (!parsed) return;
    setRunning(true);
    setResult(null);

    const names = [...parsed.byDriverName.keys()];
    let created = 0;
    let corrected = 0;
    const errors: TiqueTaqueImportRowError[] = [];

    for (let i = 0; i < names.length; i++) {
      const driverName = names[i];
      setProgress({ done: i, total: names.length, currentDriverName: driverName });
      const days = parsed.byDriverName.get(driverName)!;
      const driverResult = await importCsvForDriver(driverName, days);
      created += driverResult.created;
      corrected += driverResult.corrected;
      errors.push(...driverResult.errors);
    }

    setProgress({ done: names.length, total: names.length });
    setResult({ created, corrected, errors });
    setRunning(false);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>Arquivo de exportação em massa (.csv) *</label>
        <input
          type="file"
          accept=".csv"
          disabled={running}
          onChange={handleFileChange}
          className={inputClass}
        />
      </div>

      {parseError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{parseError}</span>
        </div>
      )}

      {parsed && !result && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          <p>
            {parsed.byDriverName.size} motorista(s) encontrado(s) no arquivo, {parsed.totalDriverDays} dia(s) com
            marcação no total.
          </p>
          <button type="button" disabled={running} onClick={handleConfirm} className={primaryButtonClass}>
            {running ? "Importando..." : "Confirmar importação"}
          </button>
        </div>
      )}

      {progress && progress.total > 0 && (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-700 transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {progress.done < progress.total
              ? `Importando motorista ${progress.done + 1} de ${progress.total}${
                  progress.currentDriverName ? ` (${progress.currentDriverName})` : ""
                }…`
              : `${progress.total} motorista(s) processado(s).`}
          </p>
        </div>
      )}

      {result && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Importação concluída — {result.created} registro(s) novo(s) importado(s)
              {result.corrected > 0 && `, ${result.corrected} registro(s) corrigido(s) (ver `}
              {result.corrected > 0 && (
                <a href="/ponto/correcoes" className="underline">
                  histórico de correções
                </a>
              )}
              {result.corrected > 0 && ")"}
              .
            </span>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-red-700">
                {result.errors.length} ocorrência(s) não importada(s):
              </p>
              <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-red-600">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    {e.driverName}
                    {e.date ? ` (${e.date})` : ""}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!parsed && !result && (
        <p className="flex items-start gap-1.5 text-xs text-slate-400">
          <Upload className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Exporte a planilha completa direto do painel do TiqueTaque e envie aqui — o pareamento já vem pronto,
          decidido pelo próprio TiqueTaque.
        </p>
      )}
    </div>
  );
}
