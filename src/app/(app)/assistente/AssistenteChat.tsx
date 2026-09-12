"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, SendHorizontal, Sparkles } from "lucide-react";
import { cardClass, badgeClass, primaryButtonClass } from "@/lib/ui";

type Mensagem = { role: "user" | "assistant"; content: string; ferramentas?: string[] };

const FERRAMENTA_LABEL: Record<string, string> = {
  buscar_motoristas: "motoristas",
  buscar_veiculos: "veículos",
  quem_estava_com_veiculo: "quem estava com o veículo",
  escalas: "escalas (SIAT)",
  viagens_ituran: "viagens (Ituran)",
  ponto: "ponto",
  multas: "multas",
  abastecimentos: "abastecimentos",
  afastamentos: "afastamentos",
  custos_do_mes: "custos do mês",
  risco_motoristas: "risco por motorista",
  pendencias_hoje: "painel Hoje",
};

// Renderizador mínimo de markdown (negrito, código, links internos, listas
// e parágrafos) — sem dangerouslySetInnerHTML: tudo vira nó React, e link
// só vira <Link> se for caminho relativo do próprio sistema.
function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="rounded bg-slate-100 px-1 font-mono text-[12px]">{p.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
    if (link) {
      const [, label, href] = link;
      if (href.startsWith("/") && !href.startsWith("//")) {
        return (
          <Link key={i} href={href} className="font-medium text-blue-700 underline underline-offset-2">
            {label}
          </Link>
        );
      }
      return <span key={i}>{label}</span>;
    }
    return <span key={i}>{p}</span>;
  });
}

function Markdown({ text }: { text: string }) {
  const linhas = text.split(/\r?\n/);
  const blocos: ReactNode[] = [];
  let lista: string[] = [];
  const flushLista = () => {
    if (lista.length === 0) return;
    blocos.push(
      <ul key={`ul-${blocos.length}`} className="my-1 list-disc space-y-0.5 pl-5">
        {lista.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>
    );
    lista = [];
  };
  for (const linha of linhas) {
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(linha);
    if (bullet) {
      lista.push(bullet[1]);
      continue;
    }
    flushLista();
    if (linha.trim() === "") continue;
    const heading = /^#{1,4}\s+(.*)$/.exec(linha);
    blocos.push(
      <p key={`p-${blocos.length}`} className={heading ? "mt-2 font-semibold text-slate-900" : "my-1"}>
        {inline(heading ? heading[1] : linha)}
      </p>
    );
  }
  flushLista();
  return <div className="text-sm leading-relaxed text-slate-800">{blocos}</div>;
}

export default function AssistenteChat({ sugestoes }: { sugestoes: string[] }) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, carregando]);

  async function enviar(pergunta: string) {
    const p = pergunta.trim();
    if (!p || carregando) return;
    setErro(null);
    setTexto("");
    const historico = mensagens.map((m) => ({ role: m.role, content: m.content }));
    setMensagens((prev) => [...prev, { role: "user", content: p }]);
    setCarregando(true);
    try {
      const res = await fetch("/api/assistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta: p, historico }),
      });
      const data = (await res.json().catch(() => ({}))) as { resposta?: string; ferramentas?: { nome: string }[]; error?: string };
      if (!res.ok || !data.resposta) {
        setErro(data.error ?? `Falha ao consultar o assistente (${res.status}).`);
        return;
      }
      setMensagens((prev) => [
        ...prev,
        { role: "assistant", content: data.resposta!, ferramentas: [...new Set((data.ferramentas ?? []).map((f) => f.nome))] },
      ]);
    } catch {
      setErro("Sem resposta do servidor — verifique a conexão e tente de novo.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardClass} flex min-h-[420px] flex-col gap-4`}>
        {mensagens.length === 0 && !carregando && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
            <Sparkles className="h-8 w-8 text-slate-300" />
            <p className="max-w-md text-sm text-slate-500">
              Pergunte em linguagem natural sobre motoristas, veículos, escalas, ponto, multas, viagens da Ituran, combustível e
              custos. Toda resposta sai de uma consulta real ao sistema.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {sugestoes.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensagens.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                m.role === "user" ? "bg-blue-700 text-sm text-white" : "border border-slate-200 bg-slate-50"
              }`}
            >
              {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : <Markdown text={m.content} />}
              {m.role === "assistant" && m.ferramentas && m.ferramentas.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-200 pt-2">
                  <span className="text-[11px] text-slate-400">Consultou:</span>
                  {m.ferramentas.map((f) => (
                    <span key={f} className={`${badgeClass} bg-white text-slate-500`}>
                      {FERRAMENTA_LABEL[f] ?? f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {carregando && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Consultando o sistema…
            </div>
          </div>
        )}
        {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
        <div ref={fimRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(texto);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar(texto);
            }
          }}
          rows={2}
          placeholder="Ex.: quem estava com o veículo TIY9J09 no dia 30/08 às 8h?"
          className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
          disabled={carregando}
        />
        <button type="submit" disabled={carregando || texto.trim().length === 0} className={`${primaryButtonClass} inline-flex items-center gap-1.5`}>
          <SendHorizontal className="h-4 w-4" /> Perguntar
        </button>
      </form>
      <p className="text-xs text-slate-400">Enter envia · Shift+Enter quebra linha · o assistente só lê dados, nunca altera nada.</p>
    </div>
  );
}
