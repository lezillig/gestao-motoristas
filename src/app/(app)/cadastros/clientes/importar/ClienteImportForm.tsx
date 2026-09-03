"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload, CheckCircle2, RefreshCw } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import {
  prepareClienteImport,
  prepareClienteSyncFromDepartamento,
  commitClienteImport,
  type ClienteImportGroup,
  type ClienteImportRow,
} from "../actions";

type Prepared = { groups: ClienteImportGroup[]; rows: ClienteImportRow[]; rowErrors: { row: number; message: string }[] };

export default function ClienteImportForm() {
  const [step, setStep] = useState<"upload" | "review" | "done">("upload");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ clientesCriados: number; motoristasVinculados: number } | null>(null);

  function applyPrepared(res: Prepared) {
    setPrepared(res);
    setNames(Object.fromEntries(res.groups.map((g) => [g.key, g.suggestedNome])));
    setStep("review");
  }

  async function handleUpload(formData: FormData) {
    setPending(true);
    setError(null);
    const res = await prepareClienteImport(formData);
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    applyPrepared(res);
  }

  async function handleSync() {
    setPending(true);
    setError(null);
    const res = await prepareClienteSyncFromDepartamento();
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    applyPrepared(res);
  }

  async function handleConfirm() {
    if (!prepared) return;
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("payload", JSON.stringify(prepared));
    for (const group of prepared.groups) {
      formData.set(`nome_${group.key}`, names[group.key] ?? group.suggestedNome);
    }
    const res = await commitClienteImport(formData);
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setResult(res);
    setStep("done");
  }

  if (step === "done" && result) {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> Importação concluída.
        </p>
        <p className="text-sm text-slate-600">
          {result.clientesCriados} cliente(s) criado(s) · {result.motoristasVinculados} motorista(s)/funcionário(s)
          vinculado(s).
        </p>
        <Link href="/cadastros/clientes" className={`${primaryButtonClass} w-fit`}>
          Ver clientes
        </Link>
      </div>
    );
  }

  if (step === "review" && prepared) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm text-slate-600">
          Encontramos {prepared.groups.length} centro(s) de custo distinto(s). Revise o nome final de cada um antes
          de confirmar — se dois forem o mesmo cliente escrito diferente, edite os dois pro mesmo texto pra evitar
          cadastro duplicado.
        </p>

        <div className="flex flex-col gap-2">
          {prepared.groups.map((g) => (
            <div key={g.key} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
              <div className="flex-1">
                <label className={labelClass}>
                  Nome do cliente
                  {g.existingClienteId && (
                    <span className="ml-1.5 font-normal text-emerald-600">(já cadastrado)</span>
                  )}
                </label>
                <input
                  value={names[g.key] ?? g.suggestedNome}
                  onChange={(e) => setNames((prev) => ({ ...prev, [g.key]: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <p className="mt-4 shrink-0 text-xs text-slate-500">
                {g.count} pessoa{g.count === 1 ? "" : "s"}
              </p>
            </div>
          ))}
        </div>

        {prepared.rowErrors.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium text-red-700">
              {prepared.rowErrors.length} linha(s) não serão importadas:
            </p>
            <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-red-600">
              {prepared.rowErrors.map((e, i) => (
                <li key={i}>
                  Linha {e.row}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={handleConfirm}
            className={`${primaryButtonClass} inline-flex items-center gap-2`}
          >
            {pending ? "Confirmando..." : `Confirmar e vincular ${prepared.rows.length} pessoa(s)`}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setStep("upload");
              setPrepared(null);
              setError(null);
            }}
            className={secondaryButtonClass}
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="mb-3 text-sm text-slate-600">
          Já dá pra puxar direto da Unidade de alocação que os motoristas/funcionários já têm cadastrada — sem
          precisar de planilha nova. Serve pra maioria dos casos; use o upload abaixo só se precisar de um
          nome de cliente diferente do texto da unidade de alocação.
        </p>
        <button
          type="button"
          onClick={handleSync}
          disabled={pending}
          className={`${primaryButtonClass} inline-flex items-center gap-2`}
        >
          <RefreshCw className="h-4 w-4" /> {pending ? "Buscando..." : "Sincronizar a partir da Unidade de alocação"}
        </button>
      </div>

      <p className="text-xs text-slate-400">
        Cliente sem motorista vinculado (ex.: locação sem motorista) não aparece por aqui — cadastre direto em
        &quot;Novo cliente&quot;.
      </p>

      <div className="border-t border-slate-200 pt-6">
        <form action={handleUpload} className="flex flex-col gap-4">
          <div>
            <label className={labelClass}>Ou envie uma planilha — colunas CPF, Nome, Centro de custo - Atual</label>
            <input
              type="file"
              name="arquivo"
              accept=".xlsx"
              required
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-700 file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-white file:hover:bg-blue-800"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={pending}
            className={`${primaryButtonClass} inline-flex w-fit items-center gap-2`}
          >
            <Upload className="h-4 w-4" /> {pending ? "Lendo arquivo..." : "Analisar planilha"}
          </button>
        </form>
      </div>
    </div>
  );
}
