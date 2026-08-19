import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  aggregateDepartments,
  createLeave,
  createPunch,
  deleteLeave,
  fetchAllEmployees,
  fetchAllLeaves,
  fetchEmployeeById,
  fetchEmployeeDays,
  fetchEmployeeLeaves,
  fetchEmployers,
  fetchRawPunches,
  updateLeave,
} from "./resources";
import { evePage, installFetchStub, type FetchStub } from "./testFetchStub";
import type { TiqueTaqueEmployee } from "./types";

let stub: FetchStub | null = null;

function stubFetch(responses: Parameters<typeof installFetchStub>[0]): FetchStub {
  stub = installFetchStub(responses);
  return stub;
}

function rawEmployee(overrides: Record<string, unknown> = {}) {
  return {
    _id: "e1",
    full_name: "JOSE ANTONIO DA SILVA",
    cpf: "11122233344",
    contract_data: { job_role: "MOTORISTA", department: "ESCOLAR - SUL 01", payment_source: "ps1" },
    ...overrides,
  };
}

function employee(overrides: Partial<TiqueTaqueEmployee> = {}): TiqueTaqueEmployee {
  return {
    id: "e1",
    fullName: "MOTORISTA",
    cpf: "1",
    jobRole: "MOTORISTA",
    dismissed: false,
    mobilePhone: null,
    hourRateCents: null,
    department: "ESCOLAR - SUL 01",
    paymentSourceId: "ps1",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.TIQUETAQUE_API_TOKEN = "token-de-teste";
  delete process.env.TIQUETAQUE_ALLOW_WRITES;
});

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("fetchAllEmployees", () => {
  it("apara espaço extra no fim do nome", async () => {
    // Regressão real: "CLEBSON MAURO DA SILVA " com espaço no fim ia direto
    // pro Driver.name e quebrava o casamento por nome na importação da
    // planilha oficial.
    stubFetch([evePage([rawEmployee({ full_name: "CLEBSON MAURO DA SILVA " })], 1)]);
    const [found] = await fetchAllEmployees();
    assert.equal(found.fullName, "CLEBSON MAURO DA SILVA");
  });

  it("descarta cadastro sem CPF", async () => {
    stubFetch([evePage([rawEmployee(), rawEmployee({ _id: "e2", cpf: null })], 2)]);
    const found = await fetchAllEmployees();
    assert.deepEqual(
      found.map((e) => e.id),
      ["e1"]
    );
  });

  it("marca desligado por dismissal_date e monta o telefone com o DDI", async () => {
    stubFetch([
      evePage(
        [
          rawEmployee({
            mobile_phone: "11999998888",
            phone_country_code: "+55",
            contract_data: { dismissal_date: "2026-01-31T12:00:00+00:00", department: "  ADM  " },
          }),
        ],
        1
      ),
    ]);
    const [found] = await fetchAllEmployees();
    assert.equal(found.dismissed, true);
    assert.equal(found.mobilePhone, "+5511999998888");
    assert.equal(found.department, "ADM");
    assert.equal(found.jobRole, "");
  });
});

describe("fetchEmployeeById", () => {
  it("busca o item direto, sem varrer a coleção inteira", async () => {
    const s = stubFetch([{ body: rawEmployee({ _id: "abc/1" }) }]);
    const found = await fetchEmployeeById("abc/1");
    assert.equal(found?.id, "abc/1");
    assert.match(s.calls[0].url, /\/employees\/abc%2F1$/);
  });

  it("devolve null pra cadastro sem CPF", async () => {
    stubFetch([{ body: rawEmployee({ cpf: null }) }]);
    assert.equal(await fetchEmployeeById("e1"), null);
  });
});

describe("aggregateDepartments", () => {
  it("conta só os ativos, ignora sem departamento e ordena", async () => {
    const departments = aggregateDepartments([
      employee({ id: "1", department: "ESCOLAR - SUL 02" }),
      employee({ id: "2", department: "ESCOLAR - SUL 01" }),
      employee({ id: "3", department: "ESCOLAR - SUL 01" }),
      employee({ id: "4", department: "ESCOLAR - SUL 01", dismissed: true }),
      employee({ id: "5", department: null }),
    ]);
    assert.deepEqual(departments, [
      { name: "ESCOLAR - SUL 01", employeeCount: 2 },
      { name: "ESCOLAR - SUL 02", employeeCount: 1 },
    ]);
  });
});

describe("fetchEmployers", () => {
  it("junta razão social com a contagem de ativos por CNPJ", async () => {
    stubFetch([
      evePage([{ _id: "ps1", name: "Azul Transportes e Turismo LTDA" }, { _id: "ps2", name: "MCZ Transportes" }], 2),
      evePage(
        [
          rawEmployee({ _id: "e1" }),
          rawEmployee({ _id: "e2" }),
          rawEmployee({
            _id: "e3",
            contract_data: { payment_source: "ps2", dismissal_date: "2026-01-01T12:00:00+00:00" },
          }),
        ],
        3
      ),
    ]);
    assert.deepEqual(await fetchEmployers(), [
      { id: "ps1", name: "Azul Transportes e Turismo LTDA", employeeCount: 2 },
      { id: "ps2", name: "MCZ Transportes", employeeCount: 0 },
    ]);
  });
});

describe("fetchRawPunches", () => {
  it("preserva batidas que o pareamento descarta (não aprovada e desconsiderada)", async () => {
    stubFetch([
      {
        body: {
          times: [
            { _id: "t1", time: "2026-08-19T07:00:00", approved: true, type: "app", location: [-23.5, -46.6] },
            {
              _id: "t2",
              time: "2026-08-19T07:01:00",
              approved: true,
              type: " desconsiderado ",
              justification: " Duplicidade de registro ",
            },
            { _id: "t3", time: "2026-08-19T16:00:00", approved: false, type: null },
          ],
        },
      },
    ]);
    const punches = await fetchRawPunches("e1", "2026-08-19", "2026-08-19");
    assert.equal(punches.length, 3);
    assert.equal(punches[1].type, "desconsiderado");
    assert.equal(punches[1].justification, "Duplicidade de registro");
    assert.equal(punches[2].approved, false);
    assert.deepEqual(punches[0].location, [-23.5, -46.6]);
    // employee_id ausente no item cai pro id consultado.
    assert.equal(punches[0].employeeId, "e1");
  });

  it("devolve lista vazia quando não há batidas", async () => {
    stubFetch([{ body: {} }]);
    assert.deepEqual(await fetchRawPunches("e1", "2026-08-19", "2026-08-19"), []);
  });
});

describe("fetchEmployeeDays", () => {
  it("pareia as batidas em dias e ignora as inválidas", async () => {
    const s = stubFetch([
      {
        body: {
          times: [
            { time: "2026-08-19T07:00:00", approved: true, type: "app" },
            { time: "2026-08-19T07:01:00", approved: true, type: "desconsiderado" },
            { time: "2026-08-19T16:00:00", approved: true, type: "app" },
          ],
        },
      },
    ]);
    const days = await fetchEmployeeDays("e1", "2026-08-19", "2026-08-19");
    assert.deepEqual(days, [
      {
        date: "2026-08-19",
        clockIn: "07:00",
        clockOut: "16:00",
        intervaloInicio: null,
        intervaloFim: null,
        pairs: [
          {
            entrada: "07:00",
            saida: "16:00",
            entradaLocation: null,
            saidaLocation: null,
            entradaType: "app",
            saidaType: "app",
          },
        ],
      },
    ]);
    assert.match(s.calls[0].url, /start_date=2026-08-19&end_date=2026-08-19&employee_id=e1/);
  });
});

describe("work-leaves", () => {
  it("converte o datetime de meio-dia UTC pra data pura", async () => {
    stubFetch([
      evePage(
        [
          {
            _id: "l1",
            employee_id: "e1",
            leave_type: "atestado",
            start_date: "2026-07-18T12:00:00+00:00",
            end_date: "2026-07-19T12:00:00+00:00",
            details: "  gripe  ",
          },
        ],
        1
      ),
    ]);
    assert.deepEqual(await fetchEmployeeLeaves("e1"), [
      {
        id: "l1",
        employeeId: "e1",
        leaveType: "atestado",
        startDate: "2026-07-18",
        endDate: "2026-07-19",
        details: "gripe",
        paidLeave: true,
      },
    ]);
  });

  it("varre a coleção inteira sem filtro de funcionário", async () => {
    const s = stubFetch([
      evePage(
        [{ _id: "l1", employee_id: "e1", leave_type: "folga", start_date: "2026-07-18T12:00:00+00:00", end_date: "2026-07-18T12:00:00+00:00" }],
        1
      ),
    ]);
    assert.equal((await fetchAllLeaves()).length, 1);
    assert.doesNotMatch(s.calls[0].url, /employee_id/);
  });
});

describe("escrita", () => {
  it("bloqueia toda escrita sem TIQUETAQUE_ALLOW_WRITES, sem tocar na rede", async () => {
    const s = stubFetch([]);
    const input = { employeeId: "e1", leaveType: "folga", startDate: "2026-08-19", endDate: "2026-08-19" };
    await assert.rejects(() => createLeave(input), /Escrita no TiqueTaque bloqueada \(createLeave\)/);
    await assert.rejects(() => updateLeave("l1", { details: "x" }), /bloqueada \(updateLeave\)/);
    await assert.rejects(() => deleteLeave("l1"), /bloqueada \(deleteLeave\)/);
    await assert.rejects(
      () => createPunch({ employeeId: "e1", time: "2026-08-19T07:00:00+00:00" }),
      /bloqueada \(createPunch\)/
    );
    assert.equal(s.calls.length, 0);
  });

  it("cria afastamento com as datas no meio-dia UTC que a API devolve na leitura", async () => {
    process.env.TIQUETAQUE_ALLOW_WRITES = "1";
    const s = stubFetch([{ body: { _id: "l9" } }]);
    const id = await createLeave({
      employeeId: "e1",
      leaveType: "folga",
      startDate: "2026-08-19",
      endDate: "2026-08-20",
      paidLeave: false,
    });
    assert.equal(id, "l9");
    assert.equal(s.calls[0].method, "POST");
    assert.deepEqual(JSON.parse(s.calls[0].body ?? "{}"), {
      employee_id: "e1",
      leave_type: "folga",
      start_date: "2026-08-19T12:00:00+00:00",
      end_date: "2026-08-20T12:00:00+00:00",
      paid_leave: false,
    });
  });

  it("lê a ETag antes de alterar e a envia em If-Match", async () => {
    process.env.TIQUETAQUE_ALLOW_WRITES = "1";
    const s = stubFetch([{ body: { _id: "l1", _etag: "etag-abc" } }, { status: 200, body: {} }]);
    await updateLeave("l1", { details: "corrigido" });
    assert.equal(s.calls[0].method, "GET");
    assert.equal(s.calls[1].method, "PATCH");
    assert.equal(s.calls[1].headers["If-Match"], "etag-abc");
    // Só o campo informado vai no corpo — PATCH parcial, não substituição.
    assert.deepEqual(JSON.parse(s.calls[1].body ?? "{}"), { details: "corrigido" });
  });

  it("aborta a escrita quando a API não devolve ETag", async () => {
    process.env.TIQUETAQUE_ALLOW_WRITES = "1";
    const s = stubFetch([{ body: { _id: "l1" } }]);
    await assert.rejects(() => deleteLeave("l1"), /não devolveu _etag/);
    assert.equal(s.calls.length, 1);
  });
});
