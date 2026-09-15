import { NextResponse, type NextRequest } from "next/server";

// Politica de seguranca de conteudo (CSP) com nonce por requisicao. O nonce e
// um codigo aleatorio novo a cada acesso: o Next le a politica do cabecalho da
// REQUISICAO e aplica o nonce nos proprios scripts; um script injetado (por
// exemplo pelo texto de uma OS da Sofit) nao tem o nonce e o navegador recusa.
// Todas as paginas ja sao dinamicas (exigem login), requisito do nonce.
//
// Modo pela variavel CSP_MODO:
//  - "report-only" (padrao): nada e bloqueado; o navegador so envia as
//    violacoes pra /api/csp-report. Fase de observacao antes de ativar.
//  - "enforce": bloqueia de verdade.
//  - "off": sem CSP.
//
// O que a politica libera e por que:
//  - img-src tile.openstreetmap.org: blocos do mapa em Utilizacao -> Auditoria;
//  - connect-src vercel.com/api/blob e *.blob.vercel-storage.com: envio do PDF
//    da convencao direto do navegador pro Vercel Blob;
//  - style-src 'unsafe-inline': estilos em atributo (graficos, Leaflet, barras
//    de progresso) — o nonce nao cobre atributo style, e o risco de estilo e
//    muito menor que o de script;
//  - em desenvolvimento, 'unsafe-eval' (React usa eval pra depuracao) e
//    websocket do recarregamento automatico.

function montarPolitica(nonce: string, desenvolvimento: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${desenvolvimento ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
    "font-src 'self' data:",
    `connect-src 'self' https://vercel.com/api/blob https://*.blob.vercel-storage.com${desenvolvimento ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const modo = process.env.CSP_MODO ?? "report-only";
  if (modo === "off") return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const politica = montarPolitica(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", politica);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(modo === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", politica);
  return response;
}

export const config = {
  matcher: [
    // Paginas apenas: fora rotas de API, arquivos estaticos e pre-carregamentos
    // de link (que nao renderizam documento).
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
