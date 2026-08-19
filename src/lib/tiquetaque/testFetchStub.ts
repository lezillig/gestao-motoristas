// Stub de `fetch` usado só pelos testes desta pasta (*.test.ts).
//
// Fica num arquivo proprio, e nao dentro de um dos testes, pra que os dois
// arquivos de teste compartilhem o mesmo stub sem um importar do outro (o
// que faria o runner executar os testes do outro arquivo de novo). Nao e
// importado por nenhum codigo de aplicacao.

export type StubResponse = {
  status?: number;
  /** Corpo serializado como JSON. Ignorado quando `text` e informado. */
  body?: unknown;
  /** Corpo cru, pra testar resposta vazia ou não-JSON. */
  text?: string;
  headers?: Record<string, string>;
};

export type StubCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

export type FetchStub = {
  calls: StubCall[];
  restore: () => void;
};

/**
 * Troca o `fetch` global por uma fila de respostas pre-programadas e registra
 * cada chamada recebida. Uma chamada a mais do que a fila comporta falha o
 * teste com mensagem explicita, em vez de devolver undefined silenciosamente.
 */
export function installFetchStub(responses: StubResponse[]): FetchStub {
  const realFetch = globalThis.fetch;
  const queue = [...responses];
  const calls: StubCall[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof init?.body === "string" ? init.body : null,
    });
    const next = queue.shift();
    if (!next) throw new Error(`fetch inesperado (fila de respostas vazia): ${String(input)}`);
    const text = next.text ?? (next.body === undefined ? "" : JSON.stringify(next.body));
    return new Response(text || null, { status: next.status ?? 200, headers: next.headers });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

/** Uma página no envelope de coleção do Eve. */
export function evePage(items: unknown[], total?: number): StubResponse {
  return { body: { _items: items, _meta: total === undefined ? {} : { total } } };
}
