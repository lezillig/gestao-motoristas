import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  TiqueTaqueApiError,
  assertWritesEnabled,
  buildQuery,
  fetchAllPages,
  isTiqueTaqueAvailable,
  tiqueTaqueRequest,
} from "./http";
import { evePage, installFetchStub, type FetchStub } from "./testFetchStub";

let stub: FetchStub | null = null;

function stubFetch(responses: Parameters<typeof installFetchStub>[0]): FetchStub {
  stub = installFetchStub(responses);
  return stub;
}

/** Espera a promessa falhar e devolve o erro já tipado como TiqueTaqueApiError. */
async function apiErrorFrom(promise: Promise<unknown>): Promise<TiqueTaqueApiError> {
  try {
    await promise;
  } catch (e) {
    assert.ok(e instanceof TiqueTaqueApiError, `esperava TiqueTaqueApiError, veio ${String(e)}`);
    return e;
  }
  throw new Error("esperava que a chamada falhasse, mas ela teve sucesso");
}

beforeEach(() => {
  process.env.TIQUETAQUE_API_TOKEN = "token-de-teste";
  delete process.env.TIQUETAQUE_ALLOW_WRITES;
});

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("isTiqueTaqueAvailable", () => {
  it("reflete a presença do token", () => {
    assert.equal(isTiqueTaqueAvailable(), true);
    delete process.env.TIQUETAQUE_API_TOKEN;
    assert.equal(isTiqueTaqueAvailable(), false);
  });
});

describe("buildQuery", () => {
  it("omite valores nulos e codifica o resto", () => {
    assert.equal(buildQuery({ a: 1, b: undefined, c: null, d: "x y&z" }), "?a=1&d=x+y%26z");
  });

  it("devolve string vazia sem parâmetros", () => {
    assert.equal(buildQuery({}), "");
  });
});

describe("tiqueTaqueRequest", () => {
  it("envia Basic auth com o prefixo public:", async () => {
    const s = stubFetch([{ body: { ok: true } }]);
    await tiqueTaqueRequest("/employees");
    assert.equal(s.calls[0].headers.Authorization, "Basic " + Buffer.from("public:token-de-teste").toString("base64"));
  });

  it("estoura com mensagem clara quando não há token", async () => {
    delete process.env.TIQUETAQUE_API_TOKEN;
    stubFetch([]);
    await assert.rejects(() => tiqueTaqueRequest("/employees"), /TIQUETAQUE_API_TOKEN não configurada/);
  });

  it("devolve erro tipado, não Error genérico", async () => {
    stubFetch([{ status: 404, text: "not found" }]);
    const error = await tiqueTaqueRequest("/naoexiste").catch((e) => e);
    assert.ok(error instanceof TiqueTaqueApiError);
    assert.equal(error.status, 404);
    assert.equal(error.isNotFound, true);
    assert.equal(error.isUnauthorized, false);
    // A mensagem de GET tem que continuar idêntica à da versão anterior: ela
    // aparece pro usuário final na lista de erros por motorista da tela de
    // importação.
    assert.equal(error.message, "TiqueTaque respondeu 404 em /naoexiste: not found");
  });

  it("classifica 412 como conflito de ETag e 405 como verbo não suportado", async () => {
    stubFetch([
      { status: 412, text: "" },
      { status: 405, text: "" },
    ]);
    const conflict = await apiErrorFrom(tiqueTaqueRequest("/work-leaves/1", { method: "PATCH" }));
    assert.equal(conflict.isPreconditionFailed, true);
    const notAllowed = await apiErrorFrom(tiqueTaqueRequest("/times/1", { method: "DELETE" }));
    assert.equal(notAllowed.isMethodNotAllowed, true);
    assert.ok(notAllowed.message.startsWith("TiqueTaque respondeu 405 em DELETE /times/1"));
  });

  it("repete em 429 com backoff e devolve o corpo da tentativa bem-sucedida", async () => {
    const s = stubFetch([{ status: 429 }, { status: 429 }, { body: { ok: true } }]);
    assert.deepEqual(await tiqueTaqueRequest<{ ok: boolean }>("/times", { retryBaseMs: 1 }), { ok: true });
    assert.equal(s.calls.length, 3);
  });

  it("desiste depois do teto de retentativas", async () => {
    const s = stubFetch([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429, text: "rate limited" }]);
    const error = await tiqueTaqueRequest("/times", { retryBaseMs: 1 }).catch((e) => e);
    assert.ok(error instanceof TiqueTaqueApiError);
    assert.equal(error.isRateLimited, true);
    assert.equal(s.calls.length, 4);
  });

  it("não espera pelo backoff quando não cabe no orçamento de tempo", async () => {
    const s = stubFetch([{ status: 429 }]);
    const started = Date.now();
    await assert.rejects(
      () => tiqueTaqueRequest("/times", { deadline: Date.now() + 5 }),
      /não há orçamento de tempo restante/
    );
    // O ponto do teste é justamente não ter dormido os 2s do backoff — foi
    // esse sono que já matou uma invocação inteira do cron em produção.
    assert.ok(Date.now() - started < 1000);
    assert.equal(s.calls.length, 1);
  });

  it("manda corpo JSON e If-Match nas escritas", async () => {
    const s = stubFetch([{ status: 200, body: { _id: "abc" } }]);
    await tiqueTaqueRequest("/work-leaves/1", { method: "PATCH", body: { details: "x" }, etag: "etag-123" });
    assert.equal(s.calls[0].method, "PATCH");
    assert.equal(s.calls[0].headers["Content-Type"], "application/json");
    assert.equal(s.calls[0].headers["If-Match"], "etag-123");
    assert.equal(s.calls[0].body, JSON.stringify({ details: "x" }));
  });

  it("não manda Content-Type nem If-Match quando não há corpo nem etag", async () => {
    const s = stubFetch([{ body: {} }]);
    await tiqueTaqueRequest("/employees");
    assert.equal(s.calls[0].headers["Content-Type"], undefined);
    assert.equal(s.calls[0].headers["If-Match"], undefined);
  });

  it("devolve null em 204 e em corpo vazio", async () => {
    stubFetch([{ status: 204 }, { status: 200, text: "" }]);
    assert.equal(await tiqueTaqueRequest("/work-leaves/1", { method: "DELETE" }), null);
    assert.equal(await tiqueTaqueRequest("/work-leaves/1"), null);
  });

  it("trata resposta não-JSON como erro tipado, não como crash de parse", async () => {
    stubFetch([{ status: 200, text: "<html>gateway</html>" }]);
    const error = await tiqueTaqueRequest("/employees").catch((e) => e);
    assert.ok(error instanceof TiqueTaqueApiError);
    assert.match(error.message, /não é JSON válido/);
  });
});

describe("fetchAllPages", () => {
  it("percorre as páginas até uma página incompleta", async () => {
    const s = stubFetch([evePage([1, 2], 3), evePage([3], 3)]);
    assert.deepEqual(await fetchAllPages<number>("/employees", {}, { maxResults: 2 }), [1, 2, 3]);
    assert.match(s.calls[0].url, /max_results=2&page=1/);
    assert.match(s.calls[1].url, /max_results=2&page=2/);
  });

  it("para quando o total já foi alcançado, mesmo com página cheia", async () => {
    const s = stubFetch([evePage([1, 2], 2)]);
    assert.deepEqual(await fetchAllPages<number>("/employees", {}, { maxResults: 2 }), [1, 2]);
    assert.equal(s.calls.length, 1);
  });

  it("para numa página vazia mesmo sem _meta.total", async () => {
    stubFetch([evePage([1, 2]), evePage([])]);
    assert.deepEqual(await fetchAllPages<number>("/work-leaves", {}, { maxResults: 2 }), [1, 2]);
  });

  it("aborta em vez de girar pra sempre quando o total é inconsistente", async () => {
    // Regressão do laço infinito: `total` maior que a quantidade real de
    // itens, com páginas sempre cheias — os laços antigos, copiados em três
    // lugares, não tinham teto de páginas.
    const s = stubFetch(Array.from({ length: 5 }, () => evePage([1, 2], 999)));
    await assert.rejects(
      () => fetchAllPages<number>("/employees", {}, { maxResults: 2, maxPages: 3 }),
      /passou de 3 páginas sem terminar/
    );
    assert.equal(s.calls.length, 3);
  });

  it("repassa os filtros em todas as páginas, codificados", async () => {
    const s = stubFetch([evePage([1], 1)]);
    await fetchAllPages("/work-leaves", { employee_id: "abc/123" }, { maxResults: 200 });
    assert.match(s.calls[0].url, /employee_id=abc%2F123/);
  });
});

describe("assertWritesEnabled", () => {
  it("bloqueia escrita por padrão", () => {
    assert.throws(() => assertWritesEnabled("createPunch"), /TIQUETAQUE_ALLOW_WRITES=1/);
  });

  it("libera com a variável ligada", () => {
    process.env.TIQUETAQUE_ALLOW_WRITES = "1";
    assert.doesNotThrow(() => assertWritesEnabled("createPunch"));
  });

  it("não aceita qualquer valor verdadeiro", () => {
    process.env.TIQUETAQUE_ALLOW_WRITES = "true";
    assert.throws(() => assertWritesEnabled("createPunch"));
  });
});
