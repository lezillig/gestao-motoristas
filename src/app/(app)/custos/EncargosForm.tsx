"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { inputClass, primaryButtonClass } from "@/lib/ui";
import { salvarEncargosPercentual } from "./actions";

export default function EncargosForm({ atual }: { atual: number | null }) {
  const router = useRouter();
  const [valor, setValor] = useState(atual == null ? "" : String(atual));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const n = valor.trim() === "" ? null : Number(valor);
        startTransition(async () => {
          const r = await salvarEncargosPercentual(n);
          setMsg({ ok: r.ok, text: r.message });
          if (r.ok) router.refresh();
        });
      }}
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Encargos sobre a folha (%)</label>
        <input
          type="number"
          min={0}
          max={300}
          step={1}
          inputMode="numeric"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="ex.: 80"
          className={`${inputClass} w-32`}
        />
      </div>
      <button type="submit" disabled={pending} className={`${primaryButtonClass} inline-flex items-center gap-1.5 py-2 text-xs disabled:opacity-60`}>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Salvar
      </button>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
    </form>
  );
}
