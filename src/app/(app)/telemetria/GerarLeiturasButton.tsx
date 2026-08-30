"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { primaryButtonClass } from "@/lib/ui";

export default function GerarLeiturasButton({ label }: { label: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    setProgress("Iniciando...");
    try {
      const res = await fetch("/api/telemetria/gerar-leituras", { method: "POST" });
      if (!res.ok || !res.body) {
        throw new Error("Falha ao iniciar a busca de leituras.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith("data:")) continue;
          const payload = JSON.parse(line.slice(5).trim());

          if (payload.status === "iniciando") {
            setProgress(`Buscando dados de ${payload.total} veículo(s) na ${payload.provider}...`);
          } else if (payload.status === "buscando") {
            setProgress(
              payload.pageCount > 1
                ? `Buscando página ${payload.page} de ${payload.pageCount}...`
                : "Buscando dados..."
            );
          } else if (payload.status === "concluido") {
            setProgress(`Concluído — ${payload.count} leitura(s) geradas.`);
          } else if (payload.status === "erro") {
            setError(payload.message);
          }
        }
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao gerar leituras.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={`${primaryButtonClass} flex items-center gap-2 disabled:opacity-60`}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </button>
      {progress && !error && <p className="text-xs text-slate-500">{progress}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
