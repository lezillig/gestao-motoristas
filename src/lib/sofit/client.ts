import type { SofitExpensesResponse, SofitFuelTransaction, SofitTransactionRaw } from "./types";

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

// A Sofit nao filtra "expenses" por tipo de item no servidor (so por data,
// via lastIntegrationDate — confirmado real que isso reduz o volume) —
// entao pagina por TODAS as despesas da empresa (manutencao, pedagio,
// pneu, combustivel...) desde `since` e filtra client-side pelas que tem
// algum item com item.type === "fuel". perPage maximo confirmado real e 20
// (acima disso a API rejeita com 422).
export async function fetchFuelTransactionsSince(since: Date): Promise<SofitFuelTransaction[]> {
  const result: SofitFuelTransaction[] = [];
  let page = 1;
  let total = Infinity;

  while ((page - 1) * SOFIT_MAX_PAGE_SIZE < total && page <= MAX_PAGES) {
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

  return result;
}
