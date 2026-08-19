// Descoberta de endpoints da API do TiqueTaque.
//
// A API v2.1 nao tem documentacao publica. Todo o conhecimento sobre ela
// neste projeto foi obtido tentando: /employees, /payment-sources, /times e
// /work-leaves funcionam; varios outros nomes plausiveis responderam 404
// (banco de horas, sobreaviso, o filtro "Unidade" do painel web). Cada
// rodada dessa investigacao custou tentativa e erro manual contra producao.
//
// Este modulo troca o "tentar na mao" por uma pergunta direta à API:
// Python-Eve (o framework que serve essa API — ver http.ts) publica um
// documento raiz em `GET /` que lista TODOS os recursos expostos, e o
// cabecalho `Allow` de cada recurso diz quais verbos ele aceita. Junto, isso
// responde de uma vez "o que existe" e "da pra escrever nisso".
//
// Uso: `npm run tiquetaque:discover` (ver scripts/tiquetaque-discover.ts).

import { TiqueTaqueApiError, TIQUETAQUE_BASE_URL, authHeader, buildQuery, tiqueTaqueRequest } from "./http";

export type TiqueTaqueResource = {
  /** Nome do recurso como a API o expoe (ex.: "work-leaves"). */
  name: string;
  href: string;
  title: string | null;
};

type EveHomeDocument = {
  _links?: {
    child?: { href?: string; title?: string }[];
  };
};

/**
 * Lista os recursos anunciados pelo documento raiz do Eve.
 *
 * Devolve `null` — em vez de estourar — quando a raiz nao e um documento de
 * descoberta (404, ou uma API atras de proxy que responde outra coisa em
 * `/`). Nesse caso caia pra sondagem (`probeResources`), que nao depende
 * desse documento existir.
 */
export async function discoverResources(): Promise<TiqueTaqueResource[] | null> {
  let home: EveHomeDocument | null;
  try {
    home = await tiqueTaqueRequest<EveHomeDocument>("/");
  } catch (e) {
    if (e instanceof TiqueTaqueApiError && (e.isNotFound || e.isMethodNotAllowed)) return null;
    throw e;
  }
  const children = home?._links?.child;
  if (!children) return null;
  return children
    .filter((child): child is { href: string; title?: string } => Boolean(child.href))
    .map((child) => ({
      name: child.href.replace(/^\//, ""),
      href: child.href.startsWith("/") ? child.href : `/${child.href}`,
      title: child.title ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type ProbeStatus = "ok" | "missing" | "forbidden" | "error";

export type ResourceProbe = {
  resource: string;
  status: ProbeStatus;
  httpStatus: number | null;
  /** Verbos anunciados no cabecalho `Allow` — diz se o recurso aceita escrita. */
  allow: string[] | null;
  /** Quantos registros a colecao tem, quando a API informa. */
  total: number | null;
  /** Campos do primeiro item, pra saber o que o recurso devolve sem abrir o corpo inteiro. */
  sampleFields: string[] | null;
  message: string | null;
};

/**
 * Nomes de recurso a sondar quando o documento raiz nao estiver disponivel,
 * e como checagem cruzada quando estiver (um recurso pode existir sem ser
 * anunciado). Os 4 primeiros sao os confirmados em producao; o resto sao
 * candidatos derivados dos menus do painel web do TiqueTaque ("Gestao de
 * ponto": escala de folgas, afastamentos, ferias, banco de horas,
 * sobreaviso, justificativas, feriados) e das convencoes de nome do Eve.
 * Sondar e barato e nao muda nada: e um GET com max_results=1.
 */
export const CANDIDATE_RESOURCES = [
  "employees",
  "payment-sources",
  "times",
  "work-leaves",
  "justifications",
  "time-justifications",
  "departments",
  "companies",
  "branches",
  "units",
  "cost-centers",
  "work-schedules",
  "schedules",
  "shifts",
  "scales",
  "time-banks",
  "hour-banks",
  "on-calls",
  "holidays",
  "vacations",
  "absences",
  "job-roles",
  "teams",
  "devices",
  "locations",
  "users",
] as const;

function fieldsOf(payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const items = body._items;
  const first = Array.isArray(items) ? items[0] : undefined;
  if (first && typeof first === "object") return Object.keys(first as Record<string, unknown>).sort();
  // Recursos fora do envelope Eve (ex.: /times devolve `{times: [...]}`).
  for (const value of Object.values(body)) {
    if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
      return Object.keys(value[0] as Record<string, unknown>).sort();
    }
  }
  return Object.keys(body).sort();
}

function totalOf(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const meta = (payload as { _meta?: { total?: unknown } })._meta;
  return typeof meta?.total === "number" ? meta.total : null;
}

/**
 * Sonda um recurso com um GET minimo e relata se ele existe, quais verbos
 * aceita e que campos devolve.
 *
 * Faz o fetch direto (em vez de usar tiqueTaqueRequest) porque precisa do
 * cabecalho `Allow` da resposta, que o wrapper descarta ao devolver so o
 * JSON.
 */
export async function probeResource(resource: string): Promise<ResourceProbe> {
  const path = `/${resource.replace(/^\//, "")}`;
  const base: ResourceProbe = {
    resource: path.slice(1),
    status: "error",
    httpStatus: null,
    allow: null,
    total: null,
    sampleFields: null,
    message: null,
  };

  try {
    const res = await fetch(`${TIQUETAQUE_BASE_URL}${path}${buildQuery({ max_results: 1 })}`, {
      headers: { Authorization: authHeader() },
    });

    const allowHeader = res.headers.get("allow");
    const allow = allowHeader
      ? allowHeader
          .split(",")
          .map((verb) => verb.trim().toUpperCase())
          .filter(Boolean)
      : null;

    if (res.status === 404) return { ...base, status: "missing", httpStatus: 404, allow };
    if (res.status === 401 || res.status === 403) {
      return { ...base, status: "forbidden", httpStatus: res.status, allow, message: "sem permissão para o recurso" };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ...base, httpStatus: res.status, allow, message: body.slice(0, 120) };
    }

    const text = await res.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      return { ...base, httpStatus: res.status, allow, message: "resposta não é JSON" };
    }
    return {
      ...base,
      status: "ok",
      httpStatus: res.status,
      allow,
      total: totalOf(payload),
      sampleFields: fieldsOf(payload),
    };
  } catch (e) {
    return { ...base, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Sonda varios recursos em SEQUENCIA, com pausa entre eles.
 *
 * Sequencial de proposito: o limite real da API e 60 req/min e sondar a
 * lista inteira em paralelo garante 429 — que e exatamente o resultado
 * ambiguo que a sondagem existe pra evitar (um 429 nao diz se o recurso
 * existe ou nao).
 */
export async function probeResources(
  resources: readonly string[],
  paceMs = 1100,
  onResult?: (probe: ResourceProbe) => void
): Promise<ResourceProbe[]> {
  const results: ResourceProbe[] = [];
  for (const [index, resource] of resources.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
    const probe = await probeResource(resource);
    onResult?.(probe);
    results.push(probe);
  }
  return results;
}
