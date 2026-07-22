import type { TiqueTaqueEmployee, TiqueTaqueDayEntry } from "./types";
import { pairPunchesIntoDays } from "./pairing";

const BASE_URL = "https://api.tiquetaque.com/v2.1";

export function isTiqueTaqueAvailable(): boolean {
  return Boolean(process.env.TIQUETAQUE_API_TOKEN);
}

function authHeader(): string {
  const token = process.env.TIQUETAQUE_API_TOKEN;
  if (!token) {
    throw new Error("TIQUETAQUE_API_TOKEN não configurada — importação do TiqueTaque indisponível.");
  }
  return "Basic " + Buffer.from(`public:${token}`).toString("base64");
}

async function tiqueTaqueFetch(path: string, retried = false): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: authHeader() },
  });
  if (res.status === 429 && !retried) {
    // Limite de 60 req/min da API — uma unica retentativa curta e suficiente
    // para o volume de chamadas deste importador (paginas de funcionarios +
    // uma consulta por motorista).
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return tiqueTaqueFetch(path, true);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TiqueTaque respondeu ${res.status} em ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

type EmployeesPage = {
  _meta?: { total?: number };
  _items?: {
    _id: string;
    full_name: string;
    cpf?: string | null;
    mobile_phone?: string | null;
    phone_country_code?: string | null;
    contract_data?: {
      job_role?: string | null;
      dismissal_date?: string | null;
      hour_rate_cents?: number | null;
    };
  }[];
};

export async function fetchAllEmployees(): Promise<TiqueTaqueEmployee[]> {
  const employees: TiqueTaqueEmployee[] = [];
  const maxResults = 200;
  let page = 1;
  for (;;) {
    const data = (await tiqueTaqueFetch(`/employees?max_results=${maxResults}&page=${page}`)) as EmployeesPage;
    const items = data._items ?? [];
    for (const item of items) {
      if (!item.cpf) continue; // alguns cadastros no TiqueTaque nao tem CPF preenchido (so NIS)
      employees.push({
        id: item._id,
        fullName: item.full_name,
        cpf: item.cpf,
        jobRole: item.contract_data?.job_role ?? "",
        dismissed: Boolean(item.contract_data?.dismissal_date),
        mobilePhone: item.mobile_phone
          ? `${item.phone_country_code ?? ""}${item.mobile_phone}`
          : null,
        hourRateCents: item.contract_data?.hour_rate_cents ?? null,
      });
    }
    const total = data._meta?.total ?? employees.length;
    if (employees.length >= total || items.length < maxResults) break;
    page++;
  }
  return employees;
}

type TimesResponse = { times?: { time: string; approved: boolean }[] };

export async function fetchEmployeeDays(
  employeeId: string,
  startDate: string,
  endDate: string
): Promise<TiqueTaqueDayEntry[]> {
  const data = (await tiqueTaqueFetch(
    `/times?start_date=${startDate}&end_date=${endDate}&employee_id=${employeeId}`
  )) as TimesResponse;
  return pairPunchesIntoDays(data.times ?? []);
}
