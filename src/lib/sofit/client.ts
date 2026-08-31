// Cliente HTTP do Sofit: autenticacao, paginacao, timeout e retentativa.
// Nada de regra de negocio aqui — o cliente entrega listas ja normalizadas
// (via src/lib/sofit/normalize.ts) e quem grava no banco e o importCore.

import { requireSofitConfig, type SofitConfig } from "./config";
import {
  asRecord,
  normalizeDriver,
  normalizeFuelSupply,
  normalizeMaintenance,
  normalizeOdometerReading,
  normalizeVehicle,
  type NormalizeResult,
} from "./normalize";
import type {
  SofitDriver,
  SofitFuelSupply,
  SofitMaintenance,
  SofitOdometerReading,
  SofitVehicle,
} from "./types";

// Lista normalizada + os itens que a API devolveu mas nao deu pra entender.
// Um item invalido NUNCA aborta a sincronizacao inteira (o mesmo criterio de
// "melhor esforco" ja usado nas importacoes de planilha): ele vira uma linha
// de erro reportada ao usuario no fim.
//
// `lidosBrutos` conta tudo que veio da API, inclusive o que nao passou pelo
// normalizador — e o numero que o historico mostra como "lidos". Contar so
// os validos faria um lote todo invalido (caminho ou mapeamento errado na
// implantacao) aparecer como "0 lidos", que parece "o Sofit nao mandou
// nada" quando na verdade mandou e nos e que nao entendemos.
export type SofitFetchResult<T> = { items: T[]; erros: string[]; lidosBrutos: number };

export type SofitPeriod = { start: Date; end: Date };

// Teto de paginas por recurso — rede de seguranca contra uma API que ignore
// o parametro de pagina e devolva a primeira pagina pra sempre (loop
// infinito consumindo a funcao serverless inteira ate o timeout).
const MAX_PAGES = 100;
const MAX_RETRIES = 3;

// Token de login (authMode "login") cacheado no modulo. Instancia serverless
// e efemera e por definicao nao compartilhada, entao isto e so pra evitar um
// POST de login por pagina dentro da MESMA invocacao — nao e cache
// distribuido nem pretende ser.
let cachedToken: { value: string; expiresAt: number } | null = null;

export function resetSofitTokenCache(): void {
  cachedToken = null;
}

function isRetryableStatus(status: number): boolean {
  // 429 (limite de requisicoes) e instabilidade momentanea de gateway. 5xx
  // generico (500) fica DE FORA de proposito: costuma ser erro de payload
  // ou de contrato, que retentar so faz demorar mais pra falhar.
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function login(config: SofitConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const res = await fetch(`${config.baseUrl}${config.loginPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      [config.loginUserField]: config.username,
      [config.loginPasswordField]: config.password,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Login no Sofit falhou (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = asRecord(await res.json().catch(() => null));
  const token = data
    ? ["token", "access_token", "accessToken", "jwt", "id_token", "chave"]
        .map((key) => data[key])
        .find((value): value is string => typeof value === "string" && value.length > 0)
    : undefined;
  if (!token) throw new Error("Login no Sofit não devolveu token reconhecível no corpo da resposta.");

  const expiresInSeconds = typeof data?.expires_in === "number" ? data.expires_in : 1800;
  cachedToken = { value: token, expiresAt: Date.now() + expiresInSeconds * 1000 };
  return token;
}

async function authHeaders(config: SofitConfig): Promise<Record<string, string>> {
  switch (config.authMode) {
    case "bearer":
      return { Authorization: `Bearer ${config.token}` };
    case "basic":
      return {
        Authorization: "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64"),
      };
    case "header":
      return { [config.tokenHeader]: config.token ?? "" };
    case "login":
      return { Authorization: `Bearer ${await login(config)}` };
  }
}

// `deadline` (timestamp absoluto comparavel a Date.now()) e opcional e serve
// a quem tem teto duro de execucao — a rota de cron, no plano Hobby da
// Vercel (60s por invocacao). Mesma solucao ja adotada no cliente do
// TiqueTaque: sem orcamento de tempo pra esperar o backoff, falha na hora em
// vez de estourar o teto da funcao inteira e perder tambem o que ja rodou.
async function sofitFetch(
  config: SofitConfig,
  path: string,
  params: Record<string, string>,
  deadline?: number,
  attempt = 0
): Promise<unknown> {
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const remaining = deadline ? deadline - Date.now() : config.timeoutMs;
  if (remaining <= 0) throw new Error(`Sem orçamento de tempo para chamar ${path} no Sofit.`);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json", ...(await authHeaders(config)) },
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, remaining)),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error(`Sofit não respondeu em ${config.timeoutMs}ms na chamada ${path}.`);
    }
    throw new Error(`Falha de rede ao chamar ${path} no Sofit: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
    const backoffMs = 2000 * 2 ** attempt; // 2s, 4s, 8s
    if (deadline !== undefined && Date.now() + backoffMs >= deadline) {
      throw new Error(`Sofit respondeu ${res.status} em ${path} e não há orçamento de tempo restante para retentativa.`);
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return sofitFetch(config, path, params, deadline, attempt + 1);
  }

  if (res.status === 401 || res.status === 403) {
    // Token de login pode ter expirado antes do prazo anunciado: joga fora o
    // cache pra proxima chamada refazer o login em vez de repetir o 401.
    resetSofitTokenCache();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sofit respondeu ${res.status} em ${path}: ${body.slice(0, 200)}`);
  }

  return res.json().catch(() => {
    throw new Error(`Sofit devolveu resposta não-JSON em ${path}.`);
  });
}

// Extrai a lista de itens de qualquer um dos envelopes comuns em API REST
// brasileira/Java (nao ha contrato publico do Sofit pra fixar um so):
// array puro, { items }, { content } (Spring Data), { data }, { _items }
// (Eve/Python, que e o formato do TiqueTaque), { results }, { registros }.
// Ultimo recurso: a primeira propriedade que for array.
function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["items", "content", "data", "_items", "results", "registros", "dados", "lista", "rows"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

// Total de itens anunciado pelo envelope, quando existe — usado so pra parar
// a paginacao mais cedo. Ausencia nao e problema: o criterio principal e
// "pagina veio com menos itens que o tamanho pedido".
function extractTotal(payload: unknown): number | null {
  const record = asRecord(payload);
  if (!record) return null;
  for (const key of ["total", "totalElements", "totalItems", "count", "totalRegistros"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  const meta = asRecord(record._meta) ?? asRecord(record.meta);
  if (meta) {
    for (const key of ["total", "totalElements", "count"]) {
      const value = meta[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return null;
}

function formatDateParam(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function fetchAllPages<T>(
  config: SofitConfig,
  path: string,
  normalize: (raw: unknown) => NormalizeResult<T>,
  options: { period?: SofitPeriod; deadline?: number; extraParams?: Record<string, string> } = {}
): Promise<SofitFetchResult<T>> {
  const items: T[] = [];
  const erros: string[] = [];
  let collected = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = {
      [config.pageParam]: String(config.firstPage + page),
      [config.pageSizeParam]: String(config.pageSize),
      ...options.extraParams,
    };
    if (options.period) {
      params[config.startDateParam] = formatDateParam(options.period.start);
      params[config.endDateParam] = formatDateParam(options.period.end);
    }

    const payload = await sofitFetch(config, path, params, options.deadline);
    const rawItems = extractItems(payload);
    for (const raw of rawItems) {
      const result = normalize(raw);
      if (result.ok) items.push(result.value);
      else erros.push(result.reason);
    }
    collected += rawItems.length;

    const total = extractTotal(payload);
    if (rawItems.length === 0) break;
    if (rawItems.length < config.pageSize) break;
    if (total !== null && collected >= total) break;
  }

  return { items, erros, lidosBrutos: collected };
}

export async function fetchSofitVehicles(deadline?: number): Promise<SofitFetchResult<SofitVehicle>> {
  const config = requireSofitConfig();
  return fetchAllPages(config, config.paths.vehicles, normalizeVehicle, { deadline });
}

export async function fetchSofitFuelSupplies(
  period: SofitPeriod,
  deadline?: number
): Promise<SofitFetchResult<SofitFuelSupply>> {
  const config = requireSofitConfig();
  return fetchAllPages(config, config.paths.fuel, normalizeFuelSupply, { period, deadline });
}

export async function fetchSofitMaintenances(
  period: SofitPeriod,
  deadline?: number
): Promise<SofitFetchResult<SofitMaintenance>> {
  const config = requireSofitConfig();
  return fetchAllPages(config, config.paths.maintenance, normalizeMaintenance, { period, deadline });
}

export async function fetchSofitOdometerReadings(
  period: SofitPeriod,
  deadline?: number
): Promise<SofitFetchResult<SofitOdometerReading>> {
  const config = requireSofitConfig();
  return fetchAllPages(config, config.paths.odometer, normalizeOdometerReading, { period, deadline });
}

export async function fetchSofitDrivers(deadline?: number): Promise<SofitFetchResult<SofitDriver>> {
  const config = requireSofitConfig();
  return fetchAllPages(config, config.paths.drivers, normalizeDriver, { deadline });
}

export type SofitConnectionTest = {
  ok: boolean;
  mensagem: string;
  // Quantos veiculos a primeira pagina devolveu — evidencia concreta de que
  // a credencial funciona E de que o caminho configurado e o certo (um 200
  // devolvendo zero item costuma ser caminho errado, nao frota vazia).
  veiculosNaPrimeiraPagina?: number;
  amostraPlacas?: string[];
};

// Chamada barata de diagnostico pra tela de integracoes: uma unica pagina
// pequena do recurso de veiculos. Nunca lanca — devolve o erro como texto
// pra ser exibido direto ao usuario.
export async function testSofitConnection(): Promise<SofitConnectionTest> {
  let config: SofitConfig;
  try {
    config = requireSofitConfig();
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : "Integração com o Sofit não configurada." };
  }

  try {
    const payload = await sofitFetch(config, config.paths.vehicles, {
      [config.pageParam]: String(config.firstPage),
      [config.pageSizeParam]: "5",
    });
    const rawItems = extractItems(payload);
    const placas = rawItems
      .map((raw) => normalizeVehicle(raw))
      .filter((r): r is { ok: true; value: SofitVehicle } => r.ok)
      .map((r) => r.value.plate)
      .slice(0, 5);

    if (rawItems.length === 0) {
      return {
        ok: false,
        mensagem: `Conexão autenticada, mas ${config.paths.vehicles} devolveu uma lista vazia — confira se o caminho do recurso está correto (SOFIT_PATH_VEICULOS).`,
        veiculosNaPrimeiraPagina: 0,
      };
    }
    return {
      ok: true,
      mensagem: `Conexão bem-sucedida — ${rawItems.length} veículo(s) na primeira página.`,
      veiculosNaPrimeiraPagina: rawItems.length,
      amostraPlacas: placas,
    };
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : "Falha desconhecida ao contatar o Sofit." };
  }
}
