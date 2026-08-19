import { createHash } from "node:crypto";
import { getIturanConfig, type IturanConfig } from "./config";
import { parseAuthToken, parsePositions, parseVehicles } from "./parse";
import type { IturanPosition, IturanVehicle } from "./types";

// Cliente HTTP da Ituran: autenticação, retentativa e paginação. Não conhece
// Prisma nem o cadastro interno — quem traduz posição em leitura de
// telemetria é src/lib/telemetry/ituranProvider.ts.

export class IturanApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "IturanApiError";
    this.status = status;
  }
}

const MAX_RETRIES = 3;
/** 429 (limite de requisições) e 5xx são transitórios; 4xx restante é erro
 * de credencial/parâmetro e repetir só queima tempo da invocação. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

type TokenCacheEntry = { token: string; expiresAt: number };

// Cache no escopo do módulo: uma instância serverless viva atende várias
// requisições, então guardar o token de sessão evita um login por sincronismo
// (a Ituran limita chamadas por minuto). A chave inclui usuário e URL para
// que trocar de credencial/ambiente não reaproveite token do anterior.
const tokenCache = new Map<string, TokenCacheEntry>();
/** Renova um pouco antes do vencimento para não usar token que expira no
 * meio do voo. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const DEFAULT_TOKEN_TTL_MS = 30 * 60_000;

export type IturanRequestOptions = {
  method?: "GET" | "POST";
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** Timestamp absoluto (comparável a Date.now()) além do qual não vale a
   * pena esperar backoff — usado pela rota de cron, que tem teto duro de 60s
   * na Vercel (mesmo padrão do cliente do TiqueTaque). */
  deadline?: number;
  skipAuth?: boolean;
};

export class IturanClient {
  private readonly config: IturanConfig;

  constructor(config?: IturanConfig) {
    this.config = config ?? getIturanConfig();
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  // Inclui a senha (como hash, para o segredo em si não virar chave de Map)
  // além de URL e usuário: trocar de credencial tem de invalidar o token em
  // cache. Sem isso, uma instância morna continuaria usando o token da senha
  // antiga e um teste de conexão com credencial errada passaria — bug visto
  // ao exercitar exatamente esse caminho.
  private cacheKey(): string {
    const secret = createHash("sha256")
      .update(`${this.config.username ?? ""}:${this.config.password ?? ""}`)
      .digest("hex")
      .slice(0, 16);
    return `${this.config.baseUrl}|${this.config.username ?? "token"}|${secret}`;
  }

  /** Token de sessão (modo "login"), reaproveitado enquanto válido. */
  private async getToken(deadline?: number): Promise<string> {
    if (this.config.authMode === "token") return this.config.token as string;

    const cached = tokenCache.get(this.cacheKey());
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const payload = await this.request(this.config.authPath, {
      method: "POST",
      skipAuth: true,
      deadline,
      body: {
        [this.config.authUsernameField]: this.config.username,
        [this.config.authPasswordField]: this.config.password,
      },
    });

    const parsed = parseAuthToken(payload);
    if (!parsed) {
      throw new IturanApiError(
        `Login na Ituran respondeu sem token reconhecível em ${this.config.authPath}. Confira ITURAN_AUTH_PATH e os nomes de campo de usuário/senha do manual de integração.`
      );
    }

    const ttlMs = parsed.expiresInSeconds ? parsed.expiresInSeconds * 1000 : DEFAULT_TOKEN_TTL_MS;
    tokenCache.set(this.cacheKey(), {
      token: parsed.token,
      expiresAt: Date.now() + Math.max(ttlMs - TOKEN_EXPIRY_SKEW_MS, 5_000),
    });
    return parsed.token;
  }

  private async request(path: string, options: IturanRequestOptions = {}, attempt = 0): Promise<unknown> {
    const { method = "GET", query, body, deadline, skipAuth } = options;

    const url = new URL(`${this.config.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (!skipAuth) {
      const token = await this.getToken(deadline);
      headers[this.config.authHeader] = this.config.authScheme ? `${this.config.authScheme} ${token}` : token;
    }

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Sem timeout, um endpoint que trava consome os 60s da invocação
        // inteira e ela morre com "Task timed out" sem diagnóstico nenhum.
        signal: AbortSignal.timeout(this.config.timeoutMs),
        cache: "no-store",
      });
    } catch (e) {
      const message = e instanceof Error && e.name === "TimeoutError"
        ? `Ituran não respondeu em ${this.config.timeoutMs}ms em ${path}.`
        : `Falha de rede ao chamar a Ituran em ${path}: ${e instanceof Error ? e.message : String(e)}`;
      if (attempt < MAX_RETRIES && this.canRetry(attempt, deadline)) {
        await this.backoff(attempt);
        return this.request(path, options, attempt + 1);
      }
      throw new IturanApiError(message);
    }

    if (!res.ok) {
      if (isRetryable(res.status) && attempt < MAX_RETRIES && this.canRetry(attempt, deadline)) {
        await this.backoff(attempt);
        return this.request(path, options, attempt + 1);
      }
      // 401/403 pode ser token de sessão revogado antes da hora: descarta o
      // cache para a próxima chamada refazer o login em vez de repetir o
      // token morto até o fim da execução.
      if (res.status === 401 || res.status === 403) tokenCache.delete(this.cacheKey());
      const text = await res.text().catch(() => "");
      throw new IturanApiError(
        `Ituran respondeu ${res.status} em ${path}: ${text.slice(0, 200)}`,
        res.status
      );
    }

    const text = await res.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new IturanApiError(
        `Ituran respondeu em ${path} com conteúdo que não é JSON (primeiros caracteres: ${text.slice(0, 80)}). Confira se ITURAN_BASE_URL aponta para a API e não para o portal web.`
      );
    }
  }

  private backoffMs(attempt: number): number {
    return 1000 * 2 ** attempt; // 1s, 2s, 4s
  }

  private canRetry(attempt: number, deadline?: number): boolean {
    if (deadline === undefined) return true;
    return Date.now() + this.backoffMs(attempt) < deadline;
  }

  private backoff(attempt: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.backoffMs(attempt)));
  }

  /** Frota cadastrada do lado da Ituran. Usado no diagnóstico da tela de
   * telemetria e para apontar placa monitorada que não existe no cadastro. */
  async listVehicles(deadline?: number): Promise<IturanVehicle[]> {
    const payload = await this.request(this.config.vehiclesPath, { deadline });
    return parseVehicles(payload);
  }

  /**
   * Posições no intervalo pedido. A API é consultada para a conta inteira e o
   * casamento com o cadastro acontece por placa depois (ver ituranProvider) —
   * pedir posição placa a placa multiplicaria as chamadas e bateria no limite
   * de requisições da Ituran.
   */
  async listPositions(options: { since: Date; until: Date; deadline?: number }): Promise<IturanPosition[]> {
    const payload = await this.request(this.config.positionsPath, {
      deadline: options.deadline,
      // Nomes de parâmetro do formato mais comum nos manuais de integração
      // brasileiros; ambos os pares (pt e en) são enviados porque o endpoint
      // ignora o que não conhece — assim o mesmo código serve aos dois
      // formatos de contrato sem uma env a mais só para isso.
      query: {
        dataInicio: options.since.toISOString(),
        dataFim: options.until.toISOString(),
        startDate: options.since.toISOString(),
        endDate: options.until.toISOString(),
      },
    });
    return parsePositions(payload);
  }

  /** Teste de conectividade para o botão "Testar conexão" da tela de
   * telemetria: valida credencial + endpoint sem gravar nada. */
  async checkConnection(): Promise<{ ok: boolean; message: string; vehicles: number | null }> {
    try {
      const vehicles = await this.listVehicles();
      return {
        ok: true,
        message: `Conexão com a Ituran OK — ${vehicles.length} veículo(s) na conta.`,
        vehicles: vehicles.length,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Falha desconhecida ao falar com a Ituran.",
        vehicles: null,
      };
    }
  }
}

