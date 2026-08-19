// Camada de transporte da API do TiqueTaque (https://api.tiquetaque.com/v2.1).
//
// Antes existia uma unica funcao `tiqueTaqueFetch` privada dentro de
// client.ts, so GET, e o laco de paginacao estava copiado 3 vezes (employees,
// payment-sources, work-leaves). Isso ficou aqui pra: (1) todo endpoint novo
// nascer ja com retentativa de 429, erro tipado e paginacao corretos; (2) dar
// suporte a POST/PATCH/DELETE, que a API expoe no estilo Eve (ver ETag mais
// abaixo) e o client antigo nao alcancava.
//
// A API e servida por Python-Eve — evidencia: as colecoes respondem com o
// envelope `{_meta: {total, page, max_results}, _items: [...]}` e os itens
// trazem `_id`/`_etag`, que sao convencoes proprias desse framework. Isso
// importa na pratica porque define o contrato de escrita (POST na colecao,
// PATCH/DELETE no item com `If-Match: <_etag>`) e a existencia do documento
// raiz de descoberta (`GET /`, ver discovery.ts). Nem todo endpoint segue
// esse envelope: `/times` devolve `{times: [...]}` cru — por isso paginacao
// e request sao funcoes separadas, e nao uma so.

export const TIQUETAQUE_BASE_URL = "https://api.tiquetaque.com/v2.1";

export type TiqueTaqueMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export function isTiqueTaqueAvailable(): boolean {
  return Boolean(process.env.TIQUETAQUE_API_TOKEN);
}

/**
 * Cabecalho `Authorization`. Exportado porque a sondagem de recursos
 * (discovery.ts) precisa fazer o fetch cru pra ler o cabecalho `Allow` da
 * resposta, que `tiqueTaqueRequest` descarta ao devolver so o JSON.
 */
export function authHeader(): string {
  const token = process.env.TIQUETAQUE_API_TOKEN;
  if (!token) {
    throw new Error("TIQUETAQUE_API_TOKEN não configurada — importação do TiqueTaque indisponível.");
  }
  return "Basic " + Buffer.from(`public:${token}`).toString("base64");
}

// Erro tipado. Antes toda falha virava um `Error` generico com a mensagem
// montada na mão, entao quem chamava nao tinha como distinguir "esse
// endpoint nao existe" (404, esperado ao sondar recursos) de "o token
// expirou" (401) ou "outra pessoa editou esse registro" (412 do Eve, ETag
// vencida) sem casar substring de mensagem. A mensagem de GET foi mantida
// byte-a-byte igual a antiga de proposito: ela aparece pro usuario final na
// lista de erros por motorista da tela de importacao.
export class TiqueTaqueApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly method: TiqueTaqueMethod;
  readonly body: string;

  constructor(status: number, method: TiqueTaqueMethod, path: string, body: string) {
    const where = method === "GET" ? path : `${method} ${path}`;
    super(`TiqueTaque respondeu ${status} em ${where}: ${body.slice(0, 200)}`);
    this.name = "TiqueTaqueApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }

  /** Recurso/registro inexistente — o sinal usado pra sondar endpoints (ver discovery.ts). */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Token ausente, invalido ou sem permissao pro recurso. */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** Verbo nao suportado pelo recurso (ex.: colecao somente-leitura). */
  get isMethodNotAllowed(): boolean {
    return this.status === 405;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /**
   * Conflito de escrita concorrente: no Eve, PATCH/DELETE com `If-Match`
   * desatualizada responde 412. Significa que o registro mudou no TiqueTaque
   * entre a leitura da ETag e a escrita — releia o item e tente de novo.
   */
  get isPreconditionFailed(): boolean {
    return this.status === 412 || this.status === 409;
  }
}

export const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 2000;

export type TiqueTaqueRequestOptions = {
  method?: TiqueTaqueMethod;
  /** Corpo JSON pra POST/PATCH/PUT. */
  body?: unknown;
  /**
   * Timestamp absoluto (comparavel com Date.now()) depois do qual nao se
   * pode mais esperar. So interessa a chamadores com teto de execucao
   * rigido — a rota de cron roda no plano Hobby da Vercel, 60s de teto duro
   * por invocacao, sem excecao. Bug real visto em producao: um 429 no meio
   * de um lote fazia a retentativa (ate 14s so de espera) estourar o teto
   * da funcao inteira, matando a invocacao ANTES do checkpoint de orcamento
   * entre motoristas — a invocacao falhava com "Task timed out" em vez de
   * parar a tempo e deixar a proxima invocacao encadeada continuar.
   */
  deadline?: number;
  /** ETag do item pro cabecalho `If-Match` (obrigatorio no Eve pra PATCH/DELETE). */
  etag?: string;
  /** Base do backoff exponencial de 429. Existe pros testes não dormirem de verdade. */
  retryBaseMs?: number;
};

/**
 * Uma requisicao à API, com retentativa de 429 e erro tipado.
 *
 * Devolve `null` quando a resposta nao tem corpo (204, tipico de DELETE).
 */
export async function tiqueTaqueRequest<T = unknown>(
  path: string,
  options: TiqueTaqueRequestOptions = {},
  attempt = 0
): Promise<T | null> {
  const { method = "GET", body, deadline, etag, retryBaseMs = DEFAULT_RETRY_BASE_MS } = options;

  const headers: Record<string, string> = { Authorization: authHeader() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (etag) headers["If-Match"] = etag;

  const res = await fetch(`${TIQUETAQUE_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    // Limite real da API: 60 req/min ("60 per 1 minute", confirmado por 429
    // reais em producao). Backoff crescente (2s, 4s, 8s) como rede de
    // seguranca contra rajadas isoladas — a defesa principal contra o limite
    // e o chamador pacear as chamadas por motorista (ver pace.ts), nao esta
    // retentativa.
    const backoffMs = retryBaseMs * 2 ** attempt;
    if (deadline !== undefined && Date.now() + backoffMs >= deadline) {
      throw new Error(`TiqueTaque respondeu 429 em ${path} e não há orçamento de tempo restante para retentativa.`);
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return tiqueTaqueRequest<T>(path, options, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TiqueTaqueApiError(res.status, method, path, text);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TiqueTaqueApiError(res.status, method, path, `resposta não é JSON válido: ${text.slice(0, 200)}`);
  }
}

/** Envelope de colecao do Eve. */
export type EveCollection<T> = {
  _meta?: { total?: number; page?: number; max_results?: number };
  _items?: T[];
};

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export function buildQuery(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// Teto de paginas por varredura. Rede de seguranca contra laco infinito:
// os lacos antigos so paravam por `_meta.total` ou por uma pagina curta, e
// uma colecao que devolvesse `total` maior que a quantidade real de itens
// (ou paginas cheias indefinidamente) girava pra sempre — dentro de uma
// funcao serverless isso vira timeout sem diagnostico. 200 paginas x 200
// itens = 40k registros, muito acima de qualquer colecao real da empresa.
const MAX_PAGES = 200;

export type PaginationOptions = {
  deadline?: number;
  maxResults?: number;
  maxPages?: number;
};

/**
 * Percorre todas as paginas de uma colecao no formato Eve e devolve os itens
 * crus, na ordem em que vieram.
 */
export async function fetchAllPages<T>(
  resource: string,
  params: QueryParams = {},
  options: PaginationOptions = {}
): Promise<T[]> {
  const { deadline, maxResults = 200, maxPages = MAX_PAGES } = options;
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const query = buildQuery({ ...params, max_results: maxResults, page });
    const data = (await tiqueTaqueRequest<EveCollection<T>>(`${resource}${query}`, { deadline })) ?? {};
    const pageItems = data._items ?? [];
    items.push(...pageItems);

    // Pagina vazia ou incompleta = acabou. `total` e usado so como corte
    // adicional; sozinho ele nao e confiavel (ja veio inconsistente com a
    // quantidade real de itens em colecoes filtradas).
    if (pageItems.length === 0 || pageItems.length < maxResults) return items;
    const total = data._meta?.total;
    if (typeof total === "number" && items.length >= total) return items;
  }

  throw new Error(
    `Paginação de ${resource} passou de ${maxPages} páginas sem terminar — provável laço infinito, varredura abortada.`
  );
}

/**
 * Escritas na API do TiqueTaque ficam desligadas por padrao e so ligam com
 * `TIQUETAQUE_ALLOW_WRITES=1`.
 *
 * Nao e paranoia generica: o TiqueTaque e o sistema de ponto eletronico
 * OFICIAL da empresa, e o registro de ponto tem valor probatorio (a mesma
 * razao pela qual este projeto mantem trilha de auditoria com hash, ver
 * src/lib/integrity.ts). Uma escrita errada — feita por um bug, um teste
 * apontando pro ambiente de producao ou uma reimportacao mal parametrizada —
 * altera a jornada legal de um funcionario real na fonte, fora do alcance da
 * nossa trilha. O padrao desligado garante que so um deploy que ligue a
 * variavel de propósito consegue escrever la.
 */
export function assertWritesEnabled(operation: string): void {
  if (process.env.TIQUETAQUE_ALLOW_WRITES !== "1") {
    throw new Error(
      `Escrita no TiqueTaque bloqueada (${operation}): defina TIQUETAQUE_ALLOW_WRITES=1 para habilitar. ` +
        "O TiqueTaque é a fonte oficial do ponto eletrônico — escrever lá altera registro com valor probatório."
    );
  }
}
