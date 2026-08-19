import type { TiqueTaqueEmployee, TiqueTaqueDayEntry, TiqueTaqueLeave } from "./types";
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

const MAX_RATE_LIMIT_RETRIES = 3;

// `deadline` (timestamp absoluto, Date.now()-comparavel) e opcional e so
// interessa a chamadores com um teto de execucao rigido (a rota de cron,
// que roda no plano Hobby da Vercel — 60s de teto duro por invocacao, sem
// excecao). Sem ele, o comportamento e o de sempre (ate 3 retentativas com
// backoff 2s/4s/8s). Bug real visto em producao: um 429 no meio de um lote
// de motoristas fazia essa retentativa (ate 14s so de espera, por chamada)
// estourar o teto de 60s da funcao inteira, matando a invocacao ANTES do
// checkpoint de orcamento entre motoristas (que so roda entre iteracoes,
// nao durante uma chamada em andamento) — a invocacao inteira falhava com
// "Task timed out" em vez de simplesmente parar a tempo e deixar a proxima
// invocacao encadeada (waitUntil) continuar de onde parou.
async function tiqueTaqueFetch(path: string, deadline?: number, attempt = 0): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: authHeader() },
  });
  if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    // Limite real da API: 60 req/min ("60 per 1 minute"). Backoff crescente
    // (2s, 4s, 8s) como rede de segurança contra rajadas isoladas — a
    // defesa principal contra o limite é o cliente pacear as chamadas por
    // motorista (ver src/lib/tiquetaque/pace.ts), não esta retentativa.
    const backoffMs = 2000 * 2 ** attempt;
    if (deadline !== undefined && Date.now() + backoffMs >= deadline) {
      throw new Error(`TiqueTaque respondeu 429 em ${path} e não há orçamento de tempo restante para retentativa.`);
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return tiqueTaqueFetch(path, deadline, attempt + 1);
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
      department?: string | null;
      payment_source?: string | null;
    };
  }[];
};

export async function fetchAllEmployees(deadline?: number): Promise<TiqueTaqueEmployee[]> {
  const employees: TiqueTaqueEmployee[] = [];
  const maxResults = 200;
  let page = 1;
  for (;;) {
    const data = (await tiqueTaqueFetch(`/employees?max_results=${maxResults}&page=${page}`, deadline)) as EmployeesPage;
    const items = data._items ?? [];
    for (const item of items) {
      if (!item.cpf) continue; // alguns cadastros no TiqueTaque nao tem CPF preenchido (so NIS)
      employees.push({
        id: item._id,
        // .trim() — o TiqueTaque as vezes devolve full_name com espaco extra
        // no fim (confirmado real: "CLEBSON MAURO DA SILVA " com espaco),
        // que ia parar direto no Driver.name e quebrava qualquer comparacao
        // exata de nome depois (ex. casamento por nome na importacao da
        // planilha oficial, src/lib/tiquetaque/csvImport.ts).
        fullName: item.full_name.trim(),
        cpf: item.cpf,
        jobRole: item.contract_data?.job_role ?? "",
        dismissed: Boolean(item.contract_data?.dismissal_date),
        mobilePhone: item.mobile_phone
          ? `${item.phone_country_code ?? ""}${item.mobile_phone}`
          : null,
        hourRateCents: item.contract_data?.hour_rate_cents ?? null,
        department: item.contract_data?.department?.trim() || null,
        paymentSourceId: item.contract_data?.payment_source ?? null,
      });
    }
    const total = data._meta?.total ?? employees.length;
    if (employees.length >= total || items.length < maxResults) break;
    page++;
  }
  return employees;
}

type PaymentSourcesPage = {
  _meta?: { total?: number };
  _items?: { _id: string; name: string }[];
};

// Resolve o id de contract_data.payment_source pro nome da razao social
// (a empresa tem mais de um CNPJ real cadastrado como empregador distinto no
// TiqueTaque — confirmado com o usuario via o campo "Empregador" no painel
// deles, que mostra nomes diferentes como "Azul Transportes e Turismo LTDA"
// e "MCZ Transportes e Turismo...").
export async function fetchPaymentSources(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const maxResults = 200;
  let page = 1;
  for (;;) {
    const data = (await tiqueTaqueFetch(`/payment-sources?max_results=${maxResults}&page=${page}`)) as PaymentSourcesPage;
    const items = data._items ?? [];
    for (const item of items) map.set(item._id, item.name);
    const total = data._meta?.total ?? map.size;
    if (map.size >= total || items.length < maxResults) break;
    page++;
  }
  return map;
}

type TimesResponse = {
  times?: { time: string; approved: boolean; location?: [number, number] | null; type?: string | null }[];
};

export async function fetchEmployeeDays(
  employeeId: string,
  startDate: string,
  endDate: string,
  deadline?: number
): Promise<TiqueTaqueDayEntry[]> {
  const data = (await tiqueTaqueFetch(
    `/times?start_date=${startDate}&end_date=${endDate}&employee_id=${employeeId}`,
    deadline
  )) as TimesResponse;
  return pairPunchesIntoDays(data.times ?? []);
}

type WorkLeavesPage = {
  _meta?: { total?: number };
  _items?: {
    _id: string;
    employee_id: string;
    leave_type: string;
    start_date: string;
    end_date: string;
    details?: string | null;
    paid_leave?: boolean;
  }[];
};

// GET /work-leaves — cobre folga/atestado/ferias/abono (confirmado real,
// diferente de varios outros candidatos que deram 404 nesta mesma API, ver
// comentario no schema em DriverLeave). start_date/end_date sempre vem como
// "AAAA-MM-DDT12:00:00+00:00" (meio-dia UTC) — os 10 primeiros caracteres ja
// sao a data local correta, sem risco do bug de fuso de celula-de-data-so.
export async function fetchEmployeeLeaves(employeeId: string): Promise<TiqueTaqueLeave[]> {
  const leaves: TiqueTaqueLeave[] = [];
  const maxResults = 200;
  let page = 1;
  for (;;) {
    const data = (await tiqueTaqueFetch(
      `/work-leaves?employee_id=${employeeId}&max_results=${maxResults}&page=${page}`
    )) as WorkLeavesPage;
    const items = data._items ?? [];
    for (const item of items) {
      leaves.push({
        id: item._id,
        employeeId: item.employee_id,
        leaveType: item.leave_type,
        startDate: item.start_date.slice(0, 10),
        endDate: item.end_date.slice(0, 10),
        details: item.details?.trim() || null,
        paidLeave: item.paid_leave ?? true,
      });
    }
    const total = data._meta?.total ?? leaves.length;
    if (leaves.length >= total || items.length < maxResults) break;
    page++;
  }
  return leaves;
}
