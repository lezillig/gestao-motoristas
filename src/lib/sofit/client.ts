import { normalizeCpf } from "@/lib/cpf";
import type {
  SofitEmployeeCnh,
  SofitEmployeeCnhRaw,
  SofitEmployeesResponse,
  SofitExpensesResponse,
  SofitFuelTransaction,
  SofitServiceOrder,
  SofitServiceOrderRaw,
  SofitServiceOrdersResponse,
  SofitTransactionRaw,
  SofitVehicle,
  SofitVehicleFullRaw,
  SofitVehiclesFullResponse,
} from "./types";

const SOFIT_MAX_PAGE_SIZE = 20; // confirmado real: perPage > 20 e rejeitado (422)
const MAX_PAGES = 500; // circuito de seguranca — ~10 mil transacoes, bem acima de 1 dia de uso

export function isSofitAvailable(): boolean {
  return Boolean(process.env.SOFIT_API_URL && process.env.SOFIT_TOKEN);
}

// Autenticacao confirmada ao vivo (2026-08-31): e o header "x-api-key", NAO
// "Authorization: Bearer" (que devolve 401 "Invalid Token" mesmo com token
// valido — so funciona pra introspeccao do schema, nao pra query de dado
// real).
async function sofitFetch<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const url = process.env.SOFIT_API_URL;
  const token = process.env.SOFIT_TOKEN;
  if (!url || !token) {
    throw new Error("Credenciais da Sofit não configuradas (SOFIT_API_URL/SOFIT_TOKEN).");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sofit respondeu ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`Sofit: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Sofit não devolveu dado.");
  return json.data;
}

const EXPENSES_QUERY = `
  query Expenses($page: Int!, $perPage: Int!, $lastIntegrationDate: DateTime!, $isIntegration: Boolean!) {
    expenses(page: $page, perPage: $perPage, lastIntegrationDate: $lastIntegrationDate, isIntegration: $isIntegration, sortField: "date", sortOrder: "ASC") {
      count
      nodes {
        id
        date
        expense_items {
          id
          date
          quantity
          unit_value
          total_value
          odometer
          real_consumption
          deviation_percentage
          distance
          doc_number
          item { name type }
          vehicle { license_plate }
          employee { name cpf }
          supplier { name }
        }
      }
    }
  }
`;

function mapTransaction(t: SofitTransactionRaw): SofitFuelTransaction {
  return {
    sofitTransactionId: String(t.id),
    dataHora: new Date(t.date ?? Date.now()),
    valorCents: t.total_value != null ? Math.round(t.total_value * 100) : null,
    volumeLitros: t.quantity,
    combustivel: t.item?.name ?? null,
    posto: t.supplier?.name ?? null,
    hodometro: t.odometer != null ? Math.round(t.odometer) : null,
    kmRodados: t.distance != null ? Math.round(t.distance) : null,
    realConsumoKmL: t.real_consumption,
    desvioConsumoPercentual: t.deviation_percentage,
    numeroAutorizacao: t.doc_number,
    plate: t.vehicle?.license_plate ?? null,
    driverName: t.employee?.name ?? null,
    driverCpf: t.employee?.cpf ?? null,
  };
}

export type FetchFuelTransactionsResult = {
  // Proxima pagina a buscar pra retomar do ponto em que o orcamento acabou.
  nextPage: number;
  transactions: SofitFuelTransaction[];
  // true quando parou por causa do orcamento de tempo, nao porque acabaram
  // as paginas — quem chama deve tentar de novo (o proximo `since` avanca
  // sozinho, ja que e derivado da ultima transacao efetivamente importada).
  hasMore: boolean;
};

// A Sofit nao filtra "expenses" por tipo de item no servidor (so por data,
// via lastIntegrationDate — confirmado real que isso reduz o volume) —
// entao pagina por TODAS as despesas da empresa (manutencao, pedagio,
// pneu, combustivel...) desde `since` e filtra client-side pelas que tem
// algum item com item.type === "fuel". perPage maximo confirmado real e 20
// (acima disso a API rejeita com 422).
//
// `deadline` (Date.now() + orcamento) para um backfill grande (ex.: desde
// 2026-01-01) nao estourar o teto de 60s da funcao serverless — para de
// pedir novas paginas antes do limite e devolve hasMore=true pra quem
// chamou decidir se continua (outro clique, ou o cron se auto-encadeando).
export async function fetchFuelTransactionsSince(
  since: Date,
  deadline: number = Date.now() + 45_000,
  startPage = 1
): Promise<FetchFuelTransactionsResult> {
  const result: SofitFuelTransaction[] = [];
  let page = Math.max(1, Math.floor(startPage));
  let total = Infinity;

  while ((page - 1) * SOFIT_MAX_PAGE_SIZE < total && page <= MAX_PAGES) {
    if (Date.now() > deadline) {
      return { transactions: result, hasMore: true, nextPage: page };
    }
    const data = await sofitFetch<SofitExpensesResponse>(EXPENSES_QUERY, {
      page,
      perPage: SOFIT_MAX_PAGE_SIZE,
      lastIntegrationDate: since.toISOString(),
      isIntegration: true,
    });
    total = data.expenses.count;
    for (const expense of data.expenses.nodes) {
      for (const item of expense.expense_items) {
        if (item.item?.type === "fuel") result.push(mapTransaction(item));
      }
    }
    page += 1;
  }

  return { transactions: result, hasMore: false, nextPage: page };
}

const SERVICE_ORDERS_QUERY = `
  query ServiceOrders($page: Int!, $perPage: Int!, $since: DateTime!) {
    serviceOrders(page: $page, perPage: $perPage, lastIntegrationDate: $since, sortField: "updated_at", sortOrder: "ASC") {
      count
      nodes {
        id name created_at updated_at type status origin request_reason problem_description total_cost
        service_start_date service_finish_date forecast_finish_date vehicle_down_days final_odometer
        vehicle { license_plate }
        supplier { name }
      }
    }
  }
`;

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Hodometro digitado errado na Sofit (visto real 2026-09-13: 12.212.212.212
// km num veiculo) estoura o inteiro do banco e, pior, viraria "km atual" no
// alerta de revisao. Limite de 500 mil km definido pelo usuario (2026-09-13)
// pra frota deles (vans e micro-onibus); acima disso o valor da Sofit e
// ignorado e so o hodometro da Ituran vale pro veiculo.
const KM_MAXIMO_PLAUSIVEL = 500_000;
function kmPlausivel(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0 || value > KM_MAXIMO_PLAUSIVEL) return null;
  return Math.round(value);
}

function mapServiceOrder(o: SofitServiceOrderRaw): SofitServiceOrder | null {
  const criadaEm = toDate(o.created_at);
  if (!criadaEm) return null;
  return {
    sofitId: String(o.id),
    numero: o.name?.trim() || `OS-${o.id}`,
    plate: o.vehicle?.license_plate?.trim().toUpperCase() || null,
    tipo: o.type,
    status: o.status,
    origem: o.origin,
    motivo: o.request_reason,
    problema: o.problem_description?.trim() || null,
    fornecedor: o.supplier?.name?.trim() || null,
    criadaEm,
    atualizadaEm: toDate(o.updated_at) ?? criadaEm,
    inicioEm: toDate(o.service_start_date),
    fimEm: toDate(o.service_finish_date),
    previsaoFimEm: toDate(o.forecast_finish_date),
    diasParado: o.vehicle_down_days,
    hodometroFinal: kmPlausivel(o.final_odometer),
    hodometroFinalBruto: o.final_odometer != null && Number.isFinite(o.final_odometer) ? Math.round(o.final_odometer) : null,
    custoCents: o.total_cost != null ? Math.round(o.total_cost * 100) : null,
  };
}

export type FetchServiceOrdersResult = { orders: SofitServiceOrder[]; hasMore: boolean; nextSince: Date };

// lastIntegrationDate filtra por updated_at >= since (confirmado real
// 2026-09-13) e a ordenacao por updated_at ASC permite um cursor estavel:
// quem chama guarda o maior updated_at visto e continua dali (o upsert por
// sofitId torna a sobreposicao de 1ms inofensiva). Pagina responde em
// ~60-230ms; a carga inicial (5.285 OS / 20 por pagina) cabe em 2-3
// invocacoes encadeadas de 40s.
export async function fetchServiceOrdersSince(since: Date, deadline: number = Date.now() + 40_000): Promise<FetchServiceOrdersResult> {
  const orders: SofitServiceOrder[] = [];
  let page = 1;
  let total = Infinity;
  let maxUpdated = since;
  while ((page - 1) * SOFIT_MAX_PAGE_SIZE < total && page <= MAX_PAGES) {
    if (Date.now() > deadline) {
      return { orders, hasMore: true, nextSince: new Date(maxUpdated.getTime() + 1) };
    }
    const data = await sofitFetch<SofitServiceOrdersResponse>(SERVICE_ORDERS_QUERY, {
      page,
      perPage: SOFIT_MAX_PAGE_SIZE,
      since: since.toISOString(),
    });
    total = data.serviceOrders.count;
    for (const raw of data.serviceOrders.nodes) {
      const o = mapServiceOrder(raw);
      if (!o) continue;
      orders.push(o);
      if (o.atualizadaEm > maxUpdated) maxUpdated = o.atualizadaEm;
    }
    if (data.serviceOrders.nodes.length < SOFIT_MAX_PAGE_SIZE) break;
    page += 1;
  }
  return { orders, hasMore: false, nextSince: new Date(maxUpdated.getTime() + 1) };
}

const VEHICLES_FULL_QUERY = `
  query Vehicles($page: Int!, $perPage: Int!) {
    vehicles(page: $page, perPage: $perPage, lastIntegrationDate: "2000-01-01T00:00:00.000Z") {
      count
      nodes {
        id license_plate status disponibility current_odometer model_year fabrication_year
        basic_maintenance_frequency_km basic_maintenance_frequency_time_num basic_maintenance_frequency_time_period
        dues { id item_id due_date recurrent_due recurrence }
      }
    }
  }
`;

function periodoEmDias(num: number | null, period: string | null): number | null {
  if (num == null || num <= 0) return null;
  const p = (period ?? "days").toLowerCase();
  if (p.startsWith("month") || p.startsWith("mes")) return Math.round(num * 30);
  if (p.startsWith("year") || p.startsWith("ano")) return Math.round(num * 365);
  if (p.startsWith("week") || p.startsWith("sem")) return Math.round(num * 7);
  return Math.round(num);
}

function mapVehicle(v: SofitVehicleFullRaw): SofitVehicle {
  return {
    sofitId: String(v.id),
    plate: v.license_plate?.trim().toUpperCase() || null,
    status: v.status,
    disponibilidade: v.disponibility,
    odometroKm: kmPlausivel(v.current_odometer),
    odometroBrutoKm: v.current_odometer != null && Number.isFinite(v.current_odometer) ? Math.round(v.current_odometer) : null,
    anoModelo: v.model_year && v.model_year > 1980 ? Math.round(v.model_year) : v.fabrication_year && v.fabrication_year > 1980 ? Math.round(v.fabrication_year) : null,
    intervaloKm: kmPlausivel(v.basic_maintenance_frequency_km),
    intervaloDias: periodoEmDias(v.basic_maintenance_frequency_time_num, v.basic_maintenance_frequency_time_period),
    dues: (v.dues ?? [])
      .map((d) => ({
        sofitDueId: String(d.id),
        itemId: d.item_id != null ? String(d.item_id) : null,
        venceEm: toDate(d.due_date),
        recorrente: Boolean(d.recurrent_due),
        recorrencia: d.recurrence,
      }))
      .filter((d): d is typeof d & { venceEm: Date } => d.venceEm != null),
  };
}

// Frota inteira da Sofit (287 veiculos / 20 por pagina = 15 paginas, ~70ms
// cada) — sem cursor incremental, e barato o bastante pra buscar tudo.
export async function fetchSofitVehicles(deadline: number = Date.now() + 40_000): Promise<SofitVehicle[]> {
  const result: SofitVehicle[] = [];
  let page = 1;
  let total = Infinity;
  while ((page - 1) * SOFIT_MAX_PAGE_SIZE < total && page <= MAX_PAGES) {
    if (Date.now() > deadline) break;
    const data = await sofitFetch<SofitVehiclesFullResponse>(VEHICLES_FULL_QUERY, { page, perPage: SOFIT_MAX_PAGE_SIZE });
    total = data.vehicles.count;
    result.push(...data.vehicles.nodes.map(mapVehicle));
    if (data.vehicles.nodes.length < SOFIT_MAX_PAGE_SIZE) break;
    page += 1;
  }
  return result;
}

// VehicleDue nao expoe a relacao com o item — resolve o nome (IPVA,
// Licenciamento, Extintor...) por id; sao ~7 ids distintos na frota toda.
export async function fetchSofitItem(id: string): Promise<{ name: string; type: string | null } | null> {
  // id inline (numerico, validado) — o tipo do argumento na Sofit nao e
  // Float nem Int declarado de forma estavel; com variavel tipada a query
  // era rejeitada (visto real 2026-09-13), inline funciona.
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  const data = await sofitFetch<{ item: { name: string | null; type: string | null } | null }>(`{ item(id: ${n}) { name type } }`, {});
  return data.item?.name ? { name: data.item.name.trim(), type: data.item.type } : null;
}

const EMPLOYEES_QUERY = `
  query Employees($page: Int!, $perPage: Int!) {
    employees(page: $page, perPage: $perPage) {
      count
      nodes {
        id
        cpf
        habilitation_num
        habilitation_category
        habilitation_due_date
      }
    }
  }
`;

function mapEmployeeCnh(e: SofitEmployeeCnhRaw): SofitEmployeeCnh | null {
  if (!e.cpf) return null; // sem CPF nao da pra casar com nenhum motorista nosso
  return {
    cpf: normalizeCpf(e.cpf),
    habilitationNum: e.habilitation_num?.trim() || null,
    habilitationCategory: e.habilitation_category?.trim().toUpperCase() || null,
    habilitationDueDate: e.habilitation_due_date,
  };
}

// Cadastro inteiro (nao ha cursor incremental tipo "since" pra funcionario,
// ao contrario de despesa) — mas e pequeno (~600 registros / perPage 20 =
// ~30 paginas), cabe folgado no orcamento de tempo de uma unica invocacao.
export async function fetchEmployeesCnh(deadline: number = Date.now() + 45_000): Promise<{ employees: SofitEmployeeCnh[]; hasMore: boolean }> {
  const result: SofitEmployeeCnh[] = [];
  let page = 1;
  let total = Infinity;

  while ((page - 1) * SOFIT_MAX_PAGE_SIZE < total && page <= MAX_PAGES) {
    if (Date.now() > deadline) {
      return { employees: result, hasMore: true };
    }
    const data = await sofitFetch<SofitEmployeesResponse>(EMPLOYEES_QUERY, {
      page,
      perPage: SOFIT_MAX_PAGE_SIZE,
    });
    total = data.employees.count;
    for (const raw of data.employees.nodes) {
      const mapped = mapEmployeeCnh(raw);
      if (mapped) result.push(mapped);
    }
    page += 1;
  }

  return { employees: result, hasMore: false };
}
