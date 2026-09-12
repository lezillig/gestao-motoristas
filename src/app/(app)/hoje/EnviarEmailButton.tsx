"use client";

import { useState, useTransition } from "react";
import { Loader2, Mail } from "lucide-react";
import { secondaryButtonClass } from "@/lib/ui";
import { enviarHojeParaMim } from "./actions";

export default function EnviarEmailButton() {
  const [pending, startTransition] = useTransition();
  const [resultado, setResultado] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => setResultado(await enviarHojeParaMim()))}
        className={`${secondaryButtonClass} inline-flex items-center gap-1.5 text-xs disabled:opacity-60`}
        title="Manda este painel por e-mail só pra você — pra conferir o visual e o provedor"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
        {pending ? "Enviando…" : "Enviar por e-mail pra mim"}
      </button>
      {resultado && <p className={`text-xs ${resultado.ok ? "text-emerald-700" : "text-red-600"}`}>{resultado.message}</p>}
    </div>
  );
}
