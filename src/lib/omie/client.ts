import { OMIE_REQUEST_PACE_MS, sleep } from "./pace";
import type { OmiePagina } from "./types";

// Cliente HTTP da API do Omie (ERP financeiro).
//
// A API é toda POST + JSON no mesmo formato, independente do recurso: a URL
// diz o módulo (ex. /api/v1/geral/clientes/) e o corpo diz o método
// (`call`), as credenciais (`app_key`/`app_secret`) e os parâmetros (`param`,
// que é SEMPRE um array de um objeto só — não é um array de vários pedidos,
// é só o formato que eles escolheram).
//
// GET não é suportado: chamar por GET é classificado como "consumo indevido"
// e conta pro bloqueio descrito em pace.ts.

// Sobrescritível por env só para apontar a integração a um mock/homologação
// em desenvolvimento; em produção a variável não é definida e vale a URL real.
const BASE_URL = process.env.OMIE_API_BASE_URL || "https://app.omie.com.br/api/v1";

// Teto por requisição. A API do Omie é notoriamente lenta em listagens
// grandes; 30s é folgado o bastante pra uma página de 500 registros e ainda
// deixa margem dentro do teto de 60s de uma função na Vercel.
const REQUEST_TIMEOUT_MS = 30_000;

export function isOmieAvailable(): boolean {
  return Boolean(process.env.OMIE_APP_KEY && process.env.OMIE_APP_SECRET);
}

function credentials(): { app_key: string; app_secret: string } {
  const appKey = process.env.OMIE_APP_KEY;
  const appSecret = process.env.OMIE_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error(
      "OMIE_APP_KEY/OMIE_APP_SECRET não configuradas — integração com o Omie indisponível."
    );
  }
  return { app_key: appKey, app_secret: appSecret };
}

// ---------- Erros ----------

/** Erro de negócio devolvido pelo Omie (faultstring/faultcode). NUNCA retentar: ver pace.ts. */
export class OmieApiError extends Error {
  constructor(
    message: string,
    readonly faultCode: string | null,
    readonly endpoint: string,
    readonly call: string
  ) {
    super(message);
    this.name = "OmieApiError";
  }
}

/**
 * Bloqueio por consumo indevido (HTTP 425) — a combinação App Key + IP +
 * método fica barrada por até 30 minutos. É um erro terminal: repetir a
 * chamada estende o bloqueio, então quem chama deve parar o sync inteiro e
 * avisar o usuário, não tentar de novo.
 */
export class OmieBloqueioError extends Error {
  constructor(readonly endpoint: string, readonly call: string) {
    super(
      `O Omie bloqueou temporariamente as chamadas de ${call} (consumo indevido, HTTP 425). ` +
        "O bloqueio dura até 30 minutos e cada nova tentativa o renova — aguarde antes de sincronizar de novo."
    );
    this.name = "OmieBloqueioError";
  }
}

/**
 * "Não existem registros para a página [N]" — o Omie sinaliza fim de
 * paginação (e listagem vazia) como ERRO, não como página vazia. Fica como
 * classe própria pra paginação tratar como fim normal em vez de falha.
 */
export class OmieSemRegistrosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmieSemRegistrosError";
  }
}

function isSemRegistros(faultstring: string): boolean {
  const normalized = faultstring
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  // Cobre as duas grafias já vistas na API ("Não existem registros para a
  // página [2]!" e "Nao existem registros!") sem depender do faultcode, que
  // varia por endpoint.
  return normalized.includes("nao existem registros");
}

// ---------- Pacing ----------
// Espaçamento global entre chamadas, mantido no módulo em vez de exigir que
// cada chamador durma por conta própria (o de tiquetaque faz assim e é fácil
// esquecer um caminho de código). Em serverless o estado é por instância, que
// é exatamente o escopo certo: é a instância que dispara as chamadas em
// sequência.
let lastRequestAt = 0;

async function paceGate() {
  const waitMs = lastRequestAt + OMIE_REQUEST_PACE_MS - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();
}

export type OmieRequestOptions = {
  /**
   * Timestamp absoluto (comparável a Date.now()) além do qual não vale a pena
   * começar outra chamada — mesmo mecanismo do cliente do TiqueTaque, pra rota
   * de cron parar a tempo em vez de estourar o teto de 60s da Vercel.
   */
  deadline?: number;
};

/**
 * Uma chamada à API do Omie. Devolve o JSON cru do método (o chamador
 * tipa/normaliza), ou lança OmieApiError/OmieBloqueioError/OmieSemRegistrosError.
 */
export async function omieRequest<T>(
  endpoint: string,
  call: string,
  param: Record<string, unknown>,
  options: OmieRequestOptions = {}
): Promise<T> {
  const { app_key, app_secret } = credentials();

  if (options.deadline !== undefined && Date.now() >= options.deadline) {
    throw new Error(`Sem orçamento de tempo restante para chamar ${call} no Omie.`);
  }

  await paceGate();

  const url = `${BASE_URL}${endpoint}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key, app_secret, param: [param] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // A integração é de leitura e roda em server actions/cron; nunca deve
      // ser servida do cache de fetch do Next (dado financeiro desatualizado
      // silenciosamente é pior que uma chamada a mais).
      cache: "no-store",
    });
  } catch (e) {
    // Falha de rede/timeout: NÃO retenta aqui de propósito. Uma requisição que
    // não chegou não é erro de negócio, mas do lado do Omie não dá pra saber
    // se ela chegou e falhou depois — e é justamente a repetição que constrói
    // o bloqueio de 30 minutos (ver pace.ts). Quem chama decide se refaz o
    // sync; como cada página é gravada assim que chega, refazer não perde o
    // que já entrou.
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Falha de rede ao chamar ${call} no Omie: ${detail}`);
  }

  if (res.status === 425) {
    throw new OmieBloqueioError(endpoint, call);
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `O Omie respondeu ${res.status} em ${call} num formato inesperado (não-JSON): ${text.slice(0, 200)}`
    );
  }

  // Erro de negócio: o Omie responde com faultstring/faultcode — em geral com
  // HTTP 500, mas já foi visto com 200, então o gatilho é a presença do campo,
  // não o status.
  const fault = body as { faultstring?: string; faultcode?: string };
  if (typeof fault.faultstring === "string" && fault.faultstring.length > 0) {
    const faultstring = fault.faultstring.trim();
    if (isSemRegistros(faultstring)) {
      throw new OmieSemRegistrosError(faultstring);
    }
    throw new OmieApiError(
      `O Omie recusou ${call}: ${faultstring}`,
      fault.faultcode ?? null,
      endpoint,
      call
    );
  }

  if (!res.ok) {
    throw new Error(`O Omie respondeu ${res.status} em ${call}: ${text.slice(0, 200)}`);
  }

  return body as T;
}

// ---------- Paginação ----------

/** Envelope comum a todas as listagens do Omie. A chave do array varia por recurso. */
type PaginaBruta = {
  pagina?: number;
  total_de_paginas?: number;
  total_de_registros?: number;
  registros?: number;
} & Record<string, unknown>;

// Máximo aceito pela API na maioria das listagens. Vale usar o teto: menos
// páginas = menos chamadas = menos exposição ao bloqueio por consumo.
export const OMIE_MAX_REGISTROS_POR_PAGINA = 500;

function extrairRegistros(body: PaginaBruta, listKey: string): unknown[] {
  const direto = body[listKey];
  if (Array.isArray(direto)) return direto;
  // Fallback: alguns métodos devolvem a lista sob uma chave diferente da
  // documentada (e a documentação do Omie diverge do retorno real em mais de
  // um endpoint). Pegar o primeiro array do corpo é melhor que devolver vazio
  // e fazer o sync mentir que "não havia registros".
  for (const value of Object.values(body)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

/**
 * Busca UMA página de uma listagem, já normalizando o envelope.
 *
 * `param` recebe pagina/registros_por_pagina automaticamente; o chamador passa
 * só os filtros do recurso.
 */
export async function omieListarPagina<TRaw>(
  endpoint: string,
  call: string,
  listKey: string,
  pagina: number,
  param: Record<string, unknown> = {},
  options: OmieRequestOptions = {}
): Promise<OmiePagina<TRaw>> {
  try {
    const body = await omieRequest<PaginaBruta>(
      endpoint,
      call,
      { pagina, registros_por_pagina: OMIE_MAX_REGISTROS_POR_PAGINA, ...param },
      options
    );
    return {
      pagina: body.pagina ?? pagina,
      totalDePaginas: body.total_de_paginas ?? 1,
      totalDeRegistros: body.total_de_registros ?? 0,
      registros: extrairRegistros(body, listKey) as TRaw[],
    };
  } catch (e) {
    // Listagem vazia chega como erro (ver OmieSemRegistrosError) — aqui vira
    // uma página vazia, que é o que ela de fato significa.
    if (e instanceof OmieSemRegistrosError) {
      return { pagina, totalDePaginas: 0, totalDeRegistros: 0, registros: [] };
    }
    throw e;
  }
}

export type PercursoResultado = {
  paginasLidas: number;
  totalDeRegistros: number;
  /** true quando a leitura parou no meio por falta de orçamento de tempo (ver `deadline`). */
  interrompidoPorTempo: boolean;
};

/**
 * Percorre todas as páginas de uma listagem chamando `onPagina` a cada uma.
 *
 * Processa página a página (em vez de acumular tudo e devolver no fim) de
 * propósito: assim o sync grava o que já leu antes de uma eventual falha no
 * meio, e um bloqueio na página 7 não descarta as 6 primeiras.
 */
export async function omiePercorrerPaginas<TRaw>(
  endpoint: string,
  call: string,
  listKey: string,
  param: Record<string, unknown>,
  onPagina: (registros: TRaw[], pagina: number, totalDePaginas: number) => Promise<void>,
  options: OmieRequestOptions = {}
): Promise<PercursoResultado> {
  let pagina = 1;
  let paginasLidas = 0;
  let totalDeRegistros = 0;

  for (;;) {
    const resultado = await omieListarPagina<TRaw>(endpoint, call, listKey, pagina, param, options);
    if (resultado.registros.length === 0) break;

    await onPagina(resultado.registros, resultado.pagina, resultado.totalDePaginas);
    paginasLidas++;
    totalDeRegistros += resultado.registros.length;

    if (pagina >= resultado.totalDePaginas) break;
    pagina++;

    // Orçamento de tempo estourado: para limpo, sem erro, e sinaliza que a
    // leitura ficou incompleta. O sync é idempotente (a chave de duplicata é o
    // código do Omie), então a próxima execução refaz do começo sem duplicar —
    // mas quem chamou precisa SABER que o resultado é parcial, senão um sync
    // interrompido passa por sync completo.
    if (options.deadline !== undefined && Date.now() >= options.deadline) {
      return { paginasLidas, totalDeRegistros, interrompidoPorTempo: true };
    }
  }

  return { paginasLidas, totalDeRegistros, interrompidoPorTempo: false };
}
