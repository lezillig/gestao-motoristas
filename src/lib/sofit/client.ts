import type {
  SofitEmployeeCnh,
  SofitEmployeeCnhRaw,
  SofitEmployeesResponse,
  SofitExpensesResponse,
  SofitFuelTransaction,
  SofitTransactionRaw,
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
  deadline: number = Date.now() + 45_000
): Promise<FetchFuelTransactionsResult> {
  const result: SofitFuelTransaction[] = [];
  let page = 1;
  let total = Infinity;

  while ((page - 1) * SOFIT_MAX_PAGE_SIZE < total && page <= MAX_PAGES) {
    if (Date.now() > deadline) {
      return { transactions: result, hasMore: true };
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

  return { transactions: result, hasMore: false };
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
    cpf: e.cpf.replace(/\D/g, ""),
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
