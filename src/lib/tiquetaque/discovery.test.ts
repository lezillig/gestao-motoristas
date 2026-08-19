import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { CANDIDATE_RESOURCES, discoverResources, probeResource, probeResources } from "./discovery";
import { installFetchStub, type FetchStub } from "./testFetchStub";

let stub: FetchStub | null = null;

function stubFetch(responses: Parameters<typeof installFetchStub>[0]): FetchStub {
  stub = installFetchStub(responses);
  return stub;
}

beforeEach(() => {
  process.env.TIQUETAQUE_API_TOKEN = "token-de-teste";
});

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("discoverResources", () => {
  it("lê os recursos anunciados pelo documento raiz do Eve", async () => {
    stubFetch([
      {
        body: {
          _links: {
            child: [
              { href: "work-leaves", title: "work_leave" },
              { href: "/employees" },
              { href: "" },
            ],
          },
        },
      },
    ]);
    assert.deepEqual(await discoverResources(), [
      { name: "employees", href: "/employees", title: null },
      { name: "work-leaves", href: "/work-leaves", title: "work_leave" },
    ]);
  });

  it("devolve null — em vez de estourar — quando a raiz não é documento de descoberta", async () => {
    stubFetch([{ status: 404, text: "not found" }]);
    assert.equal(await discoverResources(), null);
  });

  it("devolve null quando a raiz responde algo sem _links", async () => {
    stubFetch([{ body: { hello: "world" } }]);
    assert.equal(await discoverResources(), null);
  });

  it("propaga falhas que não são 'raiz não existe' (ex.: token inválido)", async () => {
    stubFetch([{ status: 401, text: "unauthorized" }]);
    await assert.rejects(() => discoverResources(), /respondeu 401/);
  });
});

describe("probeResource", () => {
  it("relata recurso disponível com total, verbos e campos do primeiro item", async () => {
    const s = stubFetch([
      {
        status: 200,
        headers: { allow: "GET, POST, DELETE" },
        body: { _meta: { total: 312 }, _items: [{ _id: "1", full_name: "X", cpf: "9" }] },
      },
    ]);
    const probe = await probeResource("employees");
    assert.equal(probe.status, "ok");
    assert.equal(probe.total, 312);
    assert.deepEqual(probe.allow, ["GET", "POST", "DELETE"]);
    assert.deepEqual(probe.sampleFields, ["_id", "cpf", "full_name"]);
    // Sondagem é barata de propósito: um item só.
    assert.match(s.calls[0].url, /max_results=1$/);
  });

  it("classifica 404 como recurso inexistente", async () => {
    stubFetch([{ status: 404, text: "" }]);
    const probe = await probeResource("/banco-de-horas");
    assert.equal(probe.status, "missing");
    assert.equal(probe.resource, "banco-de-horas");
  });

  it("distingue falta de permissão de recurso inexistente", async () => {
    stubFetch([{ status: 403, text: "" }]);
    assert.equal((await probeResource("users")).status, "forbidden");
  });

  it("lê os campos de recursos fora do envelope Eve, como /times", async () => {
    stubFetch([{ status: 200, body: { times: [{ time: "2026-08-19T07:00:00", approved: true }] } }]);
    const probe = await probeResource("times");
    assert.equal(probe.status, "ok");
    assert.deepEqual(probe.sampleFields, ["approved", "time"]);
    assert.equal(probe.total, null);
  });

  it("não estoura quando a sondagem falha — devolve o erro no relatório", async () => {
    delete process.env.TIQUETAQUE_API_TOKEN;
    stubFetch([]);
    const probe = await probeResource("employees");
    assert.equal(probe.status, "error");
    assert.match(probe.message ?? "", /TIQUETAQUE_API_TOKEN não configurada/);
  });
});

describe("probeResources", () => {
  it("sonda em sequência e devolve um resultado por recurso", async () => {
    const s = stubFetch([
      { status: 200, body: { _items: [{ a: 1 }] } },
      { status: 404, text: "" },
    ]);
    const seen: string[] = [];
    // paceMs=0: o teste não precisa esperar o 1.1s real do limite de taxa.
    const probes = await probeResources(["employees", "sobreaviso"], 0, (p) => seen.push(p.resource));
    assert.deepEqual(
      probes.map((p) => p.status),
      ["ok", "missing"]
    );
    assert.deepEqual(seen, ["employees", "sobreaviso"]);
    assert.equal(s.calls.length, 2);
  });
});

describe("CANDIDATE_RESOURCES", () => {
  it("inclui os quatro recursos já confirmados em produção", () => {
    for (const resource of ["employees", "payment-sources", "times", "work-leaves"]) {
      assert.ok(CANDIDATE_RESOURCES.includes(resource as (typeof CANDIDATE_RESOURCES)[number]), resource);
    }
  });

  it("não tem nome repetido", () => {
    assert.equal(new Set(CANDIDATE_RESOURCES).size, CANDIDATE_RESOURCES.length);
  });
});
