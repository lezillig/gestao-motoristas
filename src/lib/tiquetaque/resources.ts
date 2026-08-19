// Wrappers por recurso da API do TiqueTaque. Toda chamada à API do
// TiqueTaque no sistema passa por aqui; client.ts virou so uma fachada de
// compatibilidade que reexporta este arquivo.
//
// REGRA DESTE ARQUIVO: so entra wrapper de recurso CONFIRMADO real. A API
// publica v2.1 nao tem documentacao aberta, e varios nomes de colecao
// plausiveis ja foram investigados e responderam 404 (banco de horas,
// sobreaviso, o filtro "Unidade" do painel web). Inventar nome de colecao
// aqui produz codigo que compila, passa em review e so quebra em producao
// — quando um endpoint novo for necessario, rode antes o descobridor
// (`npm run tiquetaque:discover`, ver discovery.ts), que pergunta à propria
// API quais recursos existem, e so depois escreva o wrapper.
//
// Os 4 recursos confirmados por uso real em producao: /employees,
// /payment-sources, /times e /work-leaves.

import { pairPunchesIntoDays } from "./pairing";
import {
  assertWritesEnabled,
  fetchAllPages,
  tiqueTaqueRequest,
  buildQuery,
  type PaginationOptions,
} from "./http";
import type {
  TiqueTaqueDayEntry,
  TiqueTaqueDepartment,
  TiqueTaqueEmployee,
  TiqueTaqueEmployer,
  TiqueTaqueLeave,
  TiqueTaqueLeaveInput,
  TiqueTaqueLocation,
  TiqueTaquePunchInput,
  TiqueTaqueRawPunch,
} from "./types";

export { isTiqueTaqueAvailable } from "./http";

/* -------------------------------------------------------------------------
 * /employees
 * ---------------------------------------------------------------------- */

type RawEmployee = {
  _id: string;
  _etag?: string;
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
};

function mapEmployee(item: RawEmployee): TiqueTaqueEmployee {
  return {
    id: item._id,
    // .trim() — o TiqueTaque as vezes devolve full_name com espaco extra no
    // fim (confirmado real: "CLEBSON MAURO DA SILVA " com espaco), que ia
    // parar direto no Driver.name e quebrava qualquer comparacao exata de
    // nome depois (ex. casamento por nome na importacao da planilha oficial,
    // src/lib/tiquetaque/csvImport.ts).
    fullName: item.full_name.trim(),
    cpf: item.cpf as string,
    jobRole: item.contract_data?.job_role ?? "",
    dismissed: Boolean(item.contract_data?.dismissal_date),
    mobilePhone: item.mobile_phone ? `${item.phone_country_code ?? ""}${item.mobile_phone}` : null,
    hourRateCents: item.contract_data?.hour_rate_cents ?? null,
    department: item.contract_data?.department?.trim() || null,
    paymentSourceId: item.contract_data?.payment_source ?? null,
  };
}

export async function fetchAllEmployees(deadline?: number): Promise<TiqueTaqueEmployee[]> {
  const items = await fetchAllPages<RawEmployee>("/employees", {}, { deadline });
  // alguns cadastros no TiqueTaque nao tem CPF preenchido (so NIS) — sem CPF
  // nao ha como casar com o nosso Driver, entao ficam de fora.
  return items.filter((item) => item.cpf).map(mapEmployee);
}

/**
 * Um funcionario pelo `_id`. Util pra revalidar um vinculo salvo (ex.:
 * checar se um employeeId guardado ainda existe / foi desligado) sem
 * varrer os ~300 funcionarios inteiros so pra achar um.
 */
export async function fetchEmployeeById(employeeId: string, deadline?: number): Promise<TiqueTaqueEmployee | null> {
  const item = await tiqueTaqueRequest<RawEmployee>(`/employees/${encodeURIComponent(employeeId)}`, { deadline });
  if (!item || !item.cpf) return null;
  return mapEmployee(item);
}

/**
 * Departamentos ("unidade de alocacao") distintos, com quantos funcionarios
 * ativos cada um tem, em ordem alfabetica.
 *
 * Agregado de contract_data.department — a API v2.1 nao tem colecao propria
 * de departamentos (investigado e confirmado ausente). Serve pra popular
 * filtro/seletor na UI sem cada tela ter que varrer funcionario por
 * funcionario montando o Set na mao.
 */
export async function fetchDepartments(deadline?: number): Promise<TiqueTaqueDepartment[]> {
  const employees = await fetchAllEmployees(deadline);
  return aggregateDepartments(employees);
}

export function aggregateDepartments(employees: TiqueTaqueEmployee[]): TiqueTaqueDepartment[] {
  const counts = new Map<string, number>();
  for (const employee of employees) {
    if (employee.dismissed || !employee.department) continue;
    counts.set(employee.department, (counts.get(employee.department) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, employeeCount]) => ({ name, employeeCount }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/* -------------------------------------------------------------------------
 * /payment-sources — empregador legal (razao social por CNPJ)
 * ---------------------------------------------------------------------- */

type RawPaymentSource = { _id: string; name: string };

/**
 * Resolve o id de contract_data.payment_source pro nome da razao social (a
 * empresa tem mais de um CNPJ real cadastrado como empregador distinto no
 * TiqueTaque — confirmado com o usuario via o campo "Empregador" no painel
 * deles, que mostra nomes diferentes como "Azul Transportes e Turismo LTDA"
 * e "MCZ Transportes e Turismo...").
 */
export async function fetchPaymentSources(deadline?: number): Promise<Map<string, string>> {
  const items = await fetchAllPages<RawPaymentSource>("/payment-sources", {}, { deadline });
  return new Map(items.map((item) => [item._id, item.name]));
}

/**
 * Empregadores com a contagem de funcionarios ativos de cada um — a versao
 * "com numeros" de fetchPaymentSources, pra telas de conferencia por CNPJ
 * (quantos motoristas estao em cada empresa do grupo).
 */
export async function fetchEmployers(deadline?: number): Promise<TiqueTaqueEmployer[]> {
  // Em sequencia, nao em Promise.all: as duas varreduras juntas ja sao
  // varias paginas, e dispara-las em paralelo aproxima o teto de 60 req/min.
  const sources = await fetchPaymentSources(deadline);
  const employees = await fetchAllEmployees(deadline);
  const counts = new Map<string, number>();
  for (const employee of employees) {
    if (employee.dismissed || !employee.paymentSourceId) continue;
    counts.set(employee.paymentSourceId, (counts.get(employee.paymentSourceId) ?? 0) + 1);
  }
  return [...sources.entries()]
    .map(([id, name]) => ({ id, name, employeeCount: counts.get(id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/* -------------------------------------------------------------------------
 * /times — batidas
 * ---------------------------------------------------------------------- */

type RawTimesResponse = {
  // /times foge do envelope de colecao do Eve: devolve `{times: [...]}` cru,
  // sem _meta/_items e sem paginacao.
  times?: {
    _id?: string;
    id?: string;
    employee_id?: string;
    time: string;
    approved: boolean;
    location?: TiqueTaqueLocation | null;
    type?: string | null;
    justification?: string | null;
  }[];
};

async function requestTimes(
  employeeId: string,
  startDate: string,
  endDate: string,
  deadline?: number
): Promise<NonNullable<RawTimesResponse["times"]>> {
  const query = buildQuery({ start_date: startDate, end_date: endDate, employee_id: employeeId });
  const data = await tiqueTaqueRequest<RawTimesResponse>(`/times${query}`, { deadline });
  return data?.times ?? [];
}

/**
 * Batidas CRUAS do periodo, sem pareamento e sem filtro nenhum — inclusive
 * as pendentes de aprovacao e as invalidadas (`type: "desconsiderado"`), que
 * fetchEmployeeDays descarta de proposito. Use quando a pergunta e sobre a
 * marcacao individual (auditoria, justificativa, batida reprovada); pra
 * jornada do dia, use fetchEmployeeDays.
 */
export async function fetchRawPunches(
  employeeId: string,
  startDate: string,
  endDate: string,
  deadline?: number
): Promise<TiqueTaqueRawPunch[]> {
  const times = await requestTimes(employeeId, startDate, endDate, deadline);
  return times.map((punch) => ({
    id: punch._id ?? punch.id ?? null,
    employeeId: punch.employee_id ?? employeeId,
    time: punch.time,
    approved: punch.approved,
    location: punch.location ?? null,
    type: punch.type?.trim() || null,
    justification: punch.justification?.trim() || null,
  }));
}

/** Dias de trabalho ja pareados a partir das batidas avulsas do periodo. */
export async function fetchEmployeeDays(
  employeeId: string,
  startDate: string,
  endDate: string,
  deadline?: number
): Promise<TiqueTaqueDayEntry[]> {
  const times = await requestTimes(employeeId, startDate, endDate, deadline);
  return pairPunchesIntoDays(times);
}

/* -------------------------------------------------------------------------
 * /work-leaves — folga/atestado/ferias/abono
 * ---------------------------------------------------------------------- */

type RawWorkLeave = {
  _id: string;
  _etag?: string;
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  details?: string | null;
  paid_leave?: boolean;
};

// start_date/end_date sempre vem como "AAAA-MM-DDT12:00:00+00:00" (meio-dia
// UTC) — nunca cruzam meia-noite local mesmo em UTC-3, entao os 10 primeiros
// caracteres ja sao a data local correta, sem o risco do bug de fuso que
// celulas de data-só do Excel tem.
function mapLeave(item: RawWorkLeave): TiqueTaqueLeave {
  return {
    id: item._id,
    employeeId: item.employee_id,
    leaveType: item.leave_type,
    startDate: item.start_date.slice(0, 10),
    endDate: item.end_date.slice(0, 10),
    details: item.details?.trim() || null,
    paidLeave: item.paid_leave ?? true,
  };
}

/**
 * Afastamentos de UM funcionario. GET /work-leaves cobre folga, atestado,
 * ferias e abono de uma vez (confirmado real, diferente de varios outros
 * candidatos que deram 404 nesta mesma API).
 */
export async function fetchEmployeeLeaves(employeeId: string, deadline?: number): Promise<TiqueTaqueLeave[]> {
  const items = await fetchAllPages<RawWorkLeave>("/work-leaves", { employee_id: employeeId }, { deadline });
  return items.map(mapLeave);
}

/**
 * Afastamentos de TODOS os funcionarios numa varredura só.
 *
 * A tela de afastamentos hoje faz uma chamada por motorista, com pausa de
 * 1.1s entre elas pra nao estourar o limite de 60 req/min — com ~300
 * motoristas isso e ~5min de importacao. Como /work-leaves e uma colecao
 * Eve normal, listar a colecao inteira paginada custa uma chamada por 200
 * registros em vez de uma por motorista.
 */
export async function fetchAllLeaves(options: PaginationOptions = {}): Promise<TiqueTaqueLeave[]> {
  const items = await fetchAllPages<RawWorkLeave>("/work-leaves", {}, options);
  return items.map(mapLeave);
}

function leavePayload(input: Partial<TiqueTaqueLeaveInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.employeeId !== undefined) payload.employee_id = input.employeeId;
  if (input.leaveType !== undefined) payload.leave_type = input.leaveType;
  if (input.startDate !== undefined) payload.start_date = `${input.startDate}T12:00:00+00:00`;
  if (input.endDate !== undefined) payload.end_date = `${input.endDate}T12:00:00+00:00`;
  if (input.details !== undefined) payload.details = input.details;
  if (input.paidLeave !== undefined) payload.paid_leave = input.paidLeave;
  return payload;
}

/**
 * Cria um afastamento no TiqueTaque.
 *
 * Escrita: exige TIQUETAQUE_ALLOW_WRITES=1 (ver assertWritesEnabled em
 * http.ts). Datas sao enviadas no meio-dia UTC, o mesmo formato que a API
 * devolve na leitura.
 */
export async function createLeave(input: TiqueTaqueLeaveInput, deadline?: number): Promise<string | null> {
  assertWritesEnabled("createLeave");
  const created = await tiqueTaqueRequest<{ _id?: string }>("/work-leaves", {
    method: "POST",
    body: leavePayload(input),
    deadline,
  });
  return created?._id ?? null;
}

/**
 * Ajusta um afastamento existente. Le a ETag atual do registro antes de
 * escrever — o Eve exige `If-Match` em PATCH/DELETE e responde 412
 * (`TiqueTaqueApiError.isPreconditionFailed`) se alguem tiver mexido no
 * registro nesse meio-tempo.
 */
export async function updateLeave(
  leaveId: string,
  changes: Partial<TiqueTaqueLeaveInput>,
  deadline?: number
): Promise<void> {
  assertWritesEnabled("updateLeave");
  const etag = await fetchItemEtag("/work-leaves", leaveId, deadline);
  await tiqueTaqueRequest(`/work-leaves/${encodeURIComponent(leaveId)}`, {
    method: "PATCH",
    body: leavePayload(changes),
    etag,
    deadline,
  });
}

export async function deleteLeave(leaveId: string, deadline?: number): Promise<void> {
  assertWritesEnabled("deleteLeave");
  const etag = await fetchItemEtag("/work-leaves", leaveId, deadline);
  await tiqueTaqueRequest(`/work-leaves/${encodeURIComponent(leaveId)}`, {
    method: "DELETE",
    etag,
    deadline,
  });
}

/* -------------------------------------------------------------------------
 * Escrita de batidas
 * ---------------------------------------------------------------------- */

// ATENCAO: diferente de /work-leaves, o verbo de escrita de /times NAO foi
// confirmado contra a API real (o ambiente onde isto foi escrito nao tem
// token nem saida de rede pro TiqueTaque, e /times ja se comporta diferente
// do padrao Eve na leitura — devolve `{times: [...]}` em vez do envelope de
// colecao). Estas tres funcoes seguem a convencao Eve das demais colecoes e
// falham com erro explicito (405/404 em TiqueTaqueApiError) se a API nao
// aceitar o verbo. Antes de ligar isso em qualquer fluxo automatico,
// confirme com `npm run tiquetaque:discover`, que lista os metodos que cada
// recurso anuncia, e teste com UM registro.

/** Cria uma batida. Exige TIQUETAQUE_ALLOW_WRITES=1. */
export async function createPunch(input: TiqueTaquePunchInput, deadline?: number): Promise<string | null> {
  assertWritesEnabled("createPunch");
  const created = await tiqueTaqueRequest<{ _id?: string }>("/times", {
    method: "POST",
    body: {
      employee_id: input.employeeId,
      time: input.time,
      approved: input.approved ?? true,
      ...(input.location ? { location: input.location } : {}),
      ...(input.justification ? { justification: input.justification } : {}),
    },
    deadline,
  });
  return created?._id ?? null;
}

/** Ajusta uma batida existente. Exige TIQUETAQUE_ALLOW_WRITES=1. */
export async function updatePunch(
  punchId: string,
  changes: Partial<TiqueTaquePunchInput>,
  deadline?: number
): Promise<void> {
  assertWritesEnabled("updatePunch");
  const body: Record<string, unknown> = {};
  if (changes.time !== undefined) body.time = changes.time;
  if (changes.approved !== undefined) body.approved = changes.approved;
  if (changes.location !== undefined) body.location = changes.location;
  if (changes.justification !== undefined) body.justification = changes.justification;

  const etag = await fetchItemEtag("/times", punchId, deadline);
  await tiqueTaqueRequest(`/times/${encodeURIComponent(punchId)}`, { method: "PATCH", body, etag, deadline });
}

/**
 * Invalida uma batida. Note que o TiqueTaque tem um caminho proprio pra isso
 * (`type: "desconsiderado"` com justificativa, ver pairing.ts) que preserva
 * o historico — prefira `updatePunch` com justificativa a apagar o registro,
 * que destroi evidencia de jornada.
 */
export async function deletePunch(punchId: string, deadline?: number): Promise<void> {
  assertWritesEnabled("deletePunch");
  const etag = await fetchItemEtag("/times", punchId, deadline);
  await tiqueTaqueRequest(`/times/${encodeURIComponent(punchId)}`, { method: "DELETE", etag, deadline });
}

/* -------------------------------------------------------------------------
 * Utilitario de ETag
 * ---------------------------------------------------------------------- */

/**
 * Le a ETag atual de um item. O Eve exige `If-Match` em PATCH/DELETE: sem
 * ela a escrita e recusada (428/403), e com uma ETag velha responde 412.
 */
export async function fetchItemEtag(resource: string, id: string, deadline?: number): Promise<string> {
  const item = await tiqueTaqueRequest<{ _etag?: string }>(`${resource}/${encodeURIComponent(id)}`, { deadline });
  const etag = item?._etag;
  if (!etag) {
    throw new Error(`TiqueTaque não devolveu _etag para ${resource}/${id} — escrita abortada por segurança.`);
  }
  return etag;
}
