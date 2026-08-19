// Configuracao da integracao com o Sofit, toda por variavel de ambiente.
//
// Por que tanta coisa e configuravel (URL base, modo de autenticacao, nome
// do header, caminho de cada recurso) em vez de constante hardcoded como no
// cliente do TiqueTaque (src/lib/tiquetaque/client.ts, com BASE_URL fixa)?
// Porque o TiqueTaque tem API publica documentada e igual pra todo mundo, e
// o Sofit nao: a API deles e liberada por contrato, com host proprio por
// cliente e mapeamento de campos acordado na implantacao. Deixar isso em
// env significa que, quando o contrato real chegar do suporte do Sofit,
// ligar a integracao em producao e so preencher variaveis no Vercel — sem
// alterar codigo e sem novo deploy de emergencia.
//
// Enquanto nada estiver configurado, `isSofitConfigured()` devolve false e
// toda a integracao fica visivelmente desligada na UI (nunca quebra a
// aplicacao, mesmo padrao de `isTiqueTaqueAvailable`).

export type SofitAuthMode = "bearer" | "basic" | "header" | "login";

export type SofitPaths = {
  vehicles: string;
  fuel: string;
  maintenance: string;
  odometer: string;
  drivers: string;
};

export type SofitConfig = {
  baseUrl: string;
  authMode: SofitAuthMode;
  token: string | null;
  username: string | null;
  password: string | null;
  // Header usado quando authMode === "header" (algumas instalacoes usam
  // "X-API-Key" ou "chave", nao "Authorization").
  tokenHeader: string;
  // Caminho do login quando authMode === "login" (troca usuario/senha por
  // um token de curta duracao, cacheado em memoria — ver client.ts), e os
  // nomes dos campos do corpo desse POST.
  loginPath: string;
  loginUserField: string;
  loginPasswordField: string;
  paths: SofitPaths;
  pageSize: number;
  timeoutMs: number;
  // Nomes dos parametros de paginacao e de filtro por periodo. Variam entre
  // instalacoes (page/pagina, size/limit, dataInicio/inicio...).
  pageParam: string;
  pageSizeParam: string;
  startDateParam: string;
  endDateParam: string;
  // Pagina inicial: algumas APIs contam de 0 (padrao Spring), outras de 1.
  firstPage: number;
};

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveAuthMode(): SofitAuthMode {
  const raw = env("SOFIT_AUTH_MODE")?.toLowerCase();
  if (raw === "bearer" || raw === "basic" || raw === "header" || raw === "login") return raw;
  // Sem modo explicito: token configurado vira Bearer (caso mais comum),
  // usuario+senha vira login. Assim a maioria das instalacoes precisa
  // configurar so URL + credencial.
  if (env("SOFIT_API_TOKEN")) return "bearer";
  if (env("SOFIT_USERNAME") && env("SOFIT_PASSWORD")) return "login";
  return "bearer";
}

export function getSofitConfig(): SofitConfig | null {
  const baseUrl = env("SOFIT_API_URL");
  if (!baseUrl) return null;

  const authMode = resolveAuthMode();
  const token = env("SOFIT_API_TOKEN");
  const username = env("SOFIT_USERNAME");
  const password = env("SOFIT_PASSWORD");

  // Sem credencial nenhuma a integracao nao tem como funcionar — tratar
  // como nao configurada e melhor que deixar a UI oferecer um botao que so
  // devolve 401.
  const hasCredential = authMode === "login" || authMode === "basic" ? Boolean(username && password) : Boolean(token);
  if (!hasCredential) return null;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    authMode,
    token,
    username,
    password,
    tokenHeader: env("SOFIT_TOKEN_HEADER") ?? "X-API-Key",
    loginPath: env("SOFIT_LOGIN_PATH") ?? "/auth/login",
    loginUserField: env("SOFIT_LOGIN_CAMPO_USUARIO") ?? "usuario",
    loginPasswordField: env("SOFIT_LOGIN_CAMPO_SENHA") ?? "senha",
    paths: {
      vehicles: env("SOFIT_PATH_VEICULOS") ?? "/veiculos",
      fuel: env("SOFIT_PATH_ABASTECIMENTOS") ?? "/abastecimentos",
      maintenance: env("SOFIT_PATH_MANUTENCOES") ?? "/manutencoes",
      odometer: env("SOFIT_PATH_ODOMETRO") ?? "/odometros",
      drivers: env("SOFIT_PATH_MOTORISTAS") ?? "/motoristas",
    },
    pageSize: envInt("SOFIT_PAGE_SIZE", 200),
    // 20s por chamada: abaixo do teto de 60s da funcao serverless (plano
    // Hobby da Vercel, ver comentario na rota de cron do TiqueTaque) com
    // folga pra mais de uma pagina na mesma invocacao.
    timeoutMs: envInt("SOFIT_TIMEOUT_MS", 20_000),
    pageParam: env("SOFIT_PARAM_PAGINA") ?? "page",
    pageSizeParam: env("SOFIT_PARAM_TAMANHO") ?? "size",
    startDateParam: env("SOFIT_PARAM_DATA_INICIO") ?? "dataInicio",
    endDateParam: env("SOFIT_PARAM_DATA_FIM") ?? "dataFim",
    firstPage: env("SOFIT_PRIMEIRA_PAGINA") === "0" ? 0 : 1,
  };
}

export function isSofitConfigured(): boolean {
  return getSofitConfig() !== null;
}

export function requireSofitConfig(): SofitConfig {
  const config = getSofitConfig();
  if (!config) {
    throw new Error(
      "Integração com o Sofit não configurada — defina SOFIT_API_URL e a credencial (SOFIT_API_TOKEN ou SOFIT_USERNAME/SOFIT_PASSWORD)."
    );
  }
  return config;
}

// Resumo pra tela de integracoes: o que esta configurado, sem NUNCA expor a
// credencial em si (nem parcialmente — a pagina e visivel a GESTOR, e um
// prefixo de token ja e informacao a mais do que a tela precisa).
export function describeSofitConfig(): {
  configurado: boolean;
  baseUrl: string | null;
  authMode: SofitAuthMode | null;
  paths: SofitPaths | null;
} {
  const config = getSofitConfig();
  if (!config) return { configurado: false, baseUrl: null, authMode: null, paths: null };
  return { configurado: true, baseUrl: config.baseUrl, authMode: config.authMode, paths: config.paths };
}
