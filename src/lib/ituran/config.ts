// Configuração da integração com a Ituran.
//
// A Ituran não publica documentação aberta da API de integração: a URL base,
// os caminhos e o formato de autenticação são entregues por contrato a cada
// cliente de frota (o "manual de integração" que vem junto com as credenciais)
// e variam de contrato para contrato. Por isso tudo que muda entre contratos
// fica em variável de ambiente, e não hardcoded — apontar para o endpoint
// certo (ou trocar de homologação para produção) não exige deploy de código
// novo, só mudar env na Vercel.
//
// O que NÃO muda entre contratos (o formato dos dados de posição, o
// casamento por placa, a persistência) está em parse.ts / client.ts /
// ../telemetry/ituranProvider.ts.

export type IturanAuthMode = "token" | "login";

export type IturanConfig = {
  baseUrl: string;
  authMode: IturanAuthMode;
  /** Modo "token": credencial estática enviada em todo request. */
  token: string | null;
  /** Modo "login": usuário/senha trocados por um token de sessão. */
  username: string | null;
  password: string | null;
  authPath: string;
  authUsernameField: string;
  authPasswordField: string;
  authHeader: string;
  authScheme: string;
  vehiclesPath: string;
  positionsPath: string;
  timeoutMs: number;
};

const DEFAULTS = {
  authPath: "/auth/login",
  authUsernameField: "username",
  authPasswordField: "password",
  authHeader: "Authorization",
  authScheme: "Bearer",
  vehiclesPath: "/vehicles",
  positionsPath: "/positions",
  timeoutMs: 15_000,
};

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

/** Remove a barra final para as concatenações com path ficarem previsíveis. */
function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizePath(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

/**
 * True quando há credencial suficiente para falar com a Ituran. Enquanto for
 * false o produto segue no provedor simulado (ver ../telemetry/index.ts) —
 * a ausência de credencial nunca quebra a tela de telemetria.
 */
export function isIturanConfigured(): boolean {
  if (!env("ITURAN_BASE_URL")) return false;
  if (env("ITURAN_API_TOKEN")) return true;
  return Boolean(env("ITURAN_USERNAME") && env("ITURAN_PASSWORD"));
}

export function getIturanConfig(): IturanConfig {
  const baseUrl = env("ITURAN_BASE_URL");
  if (!baseUrl) {
    throw new Error(
      "ITURAN_BASE_URL não configurada — integração com a Ituran indisponível. Use a URL base do manual de integração fornecido pela Ituran."
    );
  }

  const token = env("ITURAN_API_TOKEN");
  const username = env("ITURAN_USERNAME");
  const password = env("ITURAN_PASSWORD");

  if (!token && !(username && password)) {
    throw new Error(
      "Credenciais da Ituran ausentes — defina ITURAN_API_TOKEN ou o par ITURAN_USERNAME/ITURAN_PASSWORD."
    );
  }

  const timeoutRaw = env("ITURAN_TIMEOUT_MS");
  const timeoutMs = timeoutRaw && Number.isFinite(Number(timeoutRaw)) ? Number(timeoutRaw) : DEFAULTS.timeoutMs;

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    // Token estático tem precedência: quando os dois estão presentes, é o
    // caminho mais barato (não gasta uma chamada de login por invocação).
    authMode: token ? "token" : "login",
    token,
    username,
    password,
    authPath: normalizePath(env("ITURAN_AUTH_PATH") ?? DEFAULTS.authPath),
    authUsernameField: env("ITURAN_AUTH_USERNAME_FIELD") ?? DEFAULTS.authUsernameField,
    authPasswordField: env("ITURAN_AUTH_PASSWORD_FIELD") ?? DEFAULTS.authPasswordField,
    authHeader: env("ITURAN_AUTH_HEADER") ?? DEFAULTS.authHeader,
    // Aceita string vazia de propósito: alguns contratos usam um header de
    // chave crua (ex.: `x-api-key: <token>`), sem prefixo de esquema.
    authScheme: process.env.ITURAN_AUTH_SCHEME ?? DEFAULTS.authScheme,
    vehiclesPath: normalizePath(env("ITURAN_VEHICLES_PATH") ?? DEFAULTS.vehiclesPath),
    positionsPath: normalizePath(env("ITURAN_POSITIONS_PATH") ?? DEFAULTS.positionsPath),
    timeoutMs,
  };
}

/**
 * Resumo da configuração para exibir no diagnóstico da tela de telemetria —
 * nunca inclui token nem senha.
 */
export function describeIturanConfig(): {
  configured: boolean;
  baseUrl: string | null;
  authMode: IturanAuthMode | null;
  username: string | null;
} {
  if (!isIturanConfigured()) {
    return { configured: false, baseUrl: env("ITURAN_BASE_URL"), authMode: null, username: null };
  }
  const config = getIturanConfig();
  return {
    configured: true,
    baseUrl: config.baseUrl,
    authMode: config.authMode,
    username: config.authMode === "login" ? config.username : null,
  };
}
