import { NextRequest } from "next/server";
import { consumirCota, ipDoCliente } from "@/lib/rateLimit";

// Recebe do navegador as violacoes da politica de seguranca (CSP, ver
// src/proxy.ts) e grava no log da Vercel com o prefixo "[csp]", pra revisar
// na fase de observacao antes de ativar o bloqueio. Rota publica por natureza
// (o navegador envia sem sessao): por isso tem limite por IP, corpo curto e so
// registra campos da violacao, nunca o corpo inteiro nem a query string.

const LIMITE_POR_IP = 60;
const JANELA_MS = 10 * 60_000;
const MAX_BYTES = 16_000;
const MAX_RELATOS = 10;

type Relato = Record<string, unknown>;

function texto(r: Relato, ...chaves: string[]): string | null {
  for (const k of chaves) {
    const v = r[k];
    if (typeof v === "string" && v) return v.slice(0, 300);
  }
  return null;
}

function semQuery(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}

export async function POST(req: NextRequest) {
  const cota = await consumirCota(`csp:${ipDoCliente(req.headers)}`, LIMITE_POR_IP, JANELA_MS);
  if (!cota.permitido) return new Response(null, { status: 204 });

  let corpo: unknown;
  try {
    corpo = JSON.parse((await req.text()).slice(0, MAX_BYTES));
  } catch {
    return new Response(null, { status: 204 });
  }

  // Formato antigo (report-uri): { "csp-report": {...} }. Formato novo
  // (Reporting API): [{ type, body: {...} }].
  const relatos: Relato[] = Array.isArray(corpo)
    ? corpo.map((item) => ((item as Relato)?.body ?? item) as Relato)
    : [((corpo as Relato)?.["csp-report"] ?? corpo) as Relato];

  for (const r of relatos.slice(0, MAX_RELATOS)) {
    if (!r || typeof r !== "object") continue;
    console.warn(
      "[csp]",
      JSON.stringify({
        diretiva: texto(r, "effective-directive", "effectiveDirective", "violated-directive", "violatedDirective"),
        bloqueado: semQuery(texto(r, "blocked-uri", "blockedURL")),
        pagina: semQuery(texto(r, "document-uri", "documentURL")),
        arquivo: semQuery(texto(r, "source-file", "sourceFile")),
        linha: r["line-number"] ?? r["lineNumber"] ?? null,
        amostra: texto(r, "script-sample", "sample"),
        modo: texto(r, "disposition"),
      })
    );
  }
  return new Response(null, { status: 204 });
}
