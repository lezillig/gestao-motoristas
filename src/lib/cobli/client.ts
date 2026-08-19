import { normalizePlate } from "@/lib/plate";
import type { CobliApiKeyStatus, CobliDevice, CobliPosition } from "./types";

// Cliente HTTP da API publica da Cobli (rastreamento/telemetria de frota).
//
// O que aqui e CONFIRMADO (lido do codigo que a propria Cobli publica em
// github.com/Cobliteam/cobli-libi e github.com/Cobliteam/cobli-bi, os
// clientes oficiais deles pra BI — nao de material de marketing):
//   - base https://api.cobli.co/
//   - autenticacao por chave no header `Cobli-Api-Key` (gerada no painel da
//     Cobli em Integrações > APIs), nao OAuth nem Basic
//   - GET /api-keys/external-auth responde 200 pra chave valida — e o
//     endpoint que o instalador oficial deles usa so pra validar a chave
//   - GET herbie-1.1/dash/device lista os dispositivos/veiculos da frota
//   - janelas de tempo nos relatorios vao em epoch de MILISSEGUNDOS
//     (`begin`/`end` ou `startTimestamp`/`endTimestamp`), com `tz` separado
//     (ex. America/Sao_Paulo) — ver COBLI_ENDPOINTS abaixo
//
// O que NAO e confirmado: o formato exato do JSON de /dash/device. A
// documentacao (docs.cobli.co) exige a conta e nao esta acessivel deste
// ambiente, e ainda nao temos chave real pra bater a resposta de verdade.
// Por isso o parser abaixo e deliberadamente tolerante: procura o mesmo dado
// em varios nomes de campo plausiveis e ignora o dispositivo (em vez de
// quebrar a sincronizacao inteira) quando nao acha. Quando a chave real
// chegar, basta conferir uma resposta de verdade e apertar o parser — o
// resto do sistema so conhece CobliDevice.
export const COBLI_BASE_URL = "https://api.cobli.co/";

// Endpoints confirmados no cliente oficial da Cobli. So `dash/device` e
// `api-keys/external-auth` estao implementados aqui (sao o que a telemetria
// do sistema consome hoje); os demais ficam registrados porque sao o mapa do
// que da pra puxar de la depois — checklists, comprovantes de conclusao,
// custos, incidentes e os relatorios de desempenho (esses dois ultimos
// respondem XLSX, nao JSON).
export const COBLI_ENDPOINTS = {
  validarChave: "api-keys/external-auth",
  dispositivos: "herbie-1.1/dash/device",
  checklists: "checklists",
  comprovantesConclusao: "herbie-1.1/planning/pocs",
  custos: "herbie-1.1/costs/report",
  incidentes: "herbie-1.1/stats/incidents/report",
  desempenhoVeiculo: "herbie-1.1/stats/performance/vehicle/report",
  desempenhoMotorista: "herbie-1.1/stats/performance/driver/report",
} as const;

export function isCobliAvailable(): boolean {
  return Boolean(process.env.COBLI_API_KEY);
}

function authHeaders(): Record<string, string> {
  const key = process.env.COBLI_API_KEY;
  if (!key) {
    throw new Error("COBLI_API_KEY não configurada — integração com a Cobli indisponível.");
  }
  return { "Cobli-Api-Key": key, "Content-Type": "application/json" };
}

const MAX_RATE_LIMIT_RETRIES = 3;

// `deadline` (timestamp absoluto comparavel com Date.now()) e opcional e so
// interessa a quem roda com teto duro de execucao — a rota de cron, no plano
// Hobby da Vercel (60s por invocacao). Mesmo cuidado ja aprendido na
// integracao do TiqueTaque: uma retentativa longa nao pode ser a causa de um
// "Task timed out" que mata a invocacao inteira antes dela conseguir
// devolver o que ja processou.
async function cobliFetch(
  path: string,
  params: Record<string, string | number> = {},
  deadline?: number,
  attempt = 0
): Promise<unknown> {
  const url = new URL(path, COBLI_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, { headers: authHeaders() });

  if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    // A Cobli nao publica o numero do limite por minuto; o backoff crescente
    // (2s, 4s, 8s) cobre rajada isolada sem depender de saber o valor exato.
    const backoffMs = 2000 * 2 ** attempt;
    if (deadline !== undefined && Date.now() + backoffMs >= deadline) {
      throw new Error(`Cobli respondeu 429 em ${path} e não há orçamento de tempo restante para retentativa.`);
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return cobliFetch(path, params, deadline, attempt + 1);
  }

  if (res.status === 401 || res.status === 403) {
    // Mensagem propria: o 401 da Cobli costuma vir com corpo vazio, e a
    // causa quase sempre e chave revogada/errada ou chave de outra frota —
    // dizer isso poupa uma rodada de investigacao.
    throw new Error(
      `Cobli recusou a autenticação (${res.status}) em ${path}. Verifique se a COBLI_API_KEY está ativa no painel da Cobli (Integrações > APIs) e se pertence à frota certa.`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Cobli respondeu ${res.status} em ${path}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

// Validacao barata da credencial, pra UI poder dizer "chave ok/chave
// recusada" sem disparar uma sincronizacao inteira. Nao lanca: devolve o
// motivo, que e o que a tela quer mostrar.
export async function validateApiKey(): Promise<CobliApiKeyStatus> {
  const key = process.env.COBLI_API_KEY;
  if (!key) return { ok: false, status: 0, message: "COBLI_API_KEY não configurada." };
  try {
    const res = await fetch(new URL(COBLI_ENDPOINTS.validarChave, COBLI_BASE_URL), {
      headers: authHeaders(),
    });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      status: res.status,
      message:
        res.status === 401 || res.status === 403
          ? "Chave recusada pela Cobli (revogada, incorreta ou de outra frota)."
          : `Cobli respondeu ${res.status} ao validar a chave.`,
    };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : "Falha de rede ao falar com a Cobli." };
  }
}

// ---------- Parsing tolerante da resposta de /dash/device ----------

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

// Busca o primeiro caminho que existir, ex. pick(raw, "vehicle.license_plate",
// "license_plate", "plate"). Existe porque o mesmo dado aparece em nomes
// diferentes conforme o recurso da Cobli (e porque ainda nao batemos a
// resposta real — ver comentario no topo do arquivo).
function pick(raw: Json, ...paths: string[]): unknown {
  for (const path of paths) {
    let current: unknown = raw;
    for (const part of path.split(".")) {
      const obj = asObject(current);
      if (!obj) {
        current = undefined;
        break;
      }
      current = obj[part];
    }
    if (current !== undefined && current !== null && current !== "") return current;
  }
  return undefined;
}

function pickString(raw: Json, ...paths: string[]): string | null {
  const value = pick(raw, ...paths);
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function pickNumber(raw: Json, ...paths: string[]): number | null {
  const value = pick(raw, ...paths);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // Alguns campos numericos da Cobli vem como string ("-23.55052") —
  // aceitar os dois evita perder posicao boa por detalhe de serializacao.
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

// Timestamps na API da Cobli sao epoch em milissegundos (confirmado nos
// parametros de janela dos relatorios, no cliente oficial deles). Ainda
// assim aceitamos segundos e ISO-8601: uma leitura com data errada por
// fator 1000 (1970 ou ano 56000) e pior que uma leitura descartada, entao o
// que nao for reconhecido vira null e o dispositivo entra como "sem
// posicao".
function parseTimestamp(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // 1e11 ms = 1973; 1e11 s = ano 5138. Acima disso so faz sentido como ms.
    const ms = value >= 1e11 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== "") return parseTimestamp(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function parsePosition(raw: Json): CobliPosition | null {
  const latitude = pickNumber(
    raw,
    "latitude",
    "lat",
    "last_position.latitude",
    "last_position.lat",
    "position.latitude",
    "position.lat",
    "location.latitude",
    "location.lat",
    "gps.latitude"
  );
  const longitude = pickNumber(
    raw,
    "longitude",
    "lng",
    "lon",
    "last_position.longitude",
    "last_position.lng",
    "position.longitude",
    "position.lng",
    "location.longitude",
    "location.lng",
    "gps.longitude"
  );
  if (latitude === null || longitude === null) return null;
  // Coordenada (0,0) e o "null ilha" no Golfo da Guine: na pratica sempre
  // significa GPS sem fix, nunca um veiculo de fretamento brasileiro.
  if (latitude === 0 && longitude === 0) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const recordedAt = parseTimestamp(
    pick(
      raw,
      "last_position.timestamp",
      "last_position.time",
      "last_position.recorded_at",
      "position.timestamp",
      "position.time",
      "timestamp",
      "last_seen",
      "last_communication",
      "updated_at"
    )
  );
  if (!recordedAt) return null;

  const speed = pickNumber(raw, "speed", "speed_kmh", "last_position.speed", "position.speed", "velocity");
  return {
    latitude,
    longitude,
    speedKmh: speed !== null && speed > 0 ? speed : 0,
    recordedAt,
  };
}

function parseDevice(raw: unknown): CobliDevice | null {
  const obj = asObject(raw);
  if (!obj) return null;

  const deviceId = pickString(obj, "id", "device_id", "deviceId", "_id", "uuid", "device.id");
  if (!deviceId) return null;

  const plateRaw = pickString(
    obj,
    "vehicle.license_plate",
    "license_plate",
    "licensePlate",
    "plate",
    "vehicle.plate",
    "vehicle.licensePlate"
  );

  return {
    deviceId,
    plate: plateRaw ? normalizePlate(plateRaw) : null,
    label: pickString(obj, "name", "label", "alias", "vehicle.name", "vehicle.alias"),
    position: parsePosition(obj),
  };
}

// A resposta pode vir como array cru ou embrulhada (`data`, `items`,
// `devices`, `content`) — o cliente oficial da Cobli joga o JSON direto num
// DataFrame do pandas, o que aceita as duas formas sem distinguir, entao a
// forma exata nao da pra deduzir de la.
function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = asObject(payload);
  if (!obj) return [];
  for (const key of ["data", "items", "devices", "content", "results", "_items"]) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export async function fetchDevices(deadline?: number): Promise<CobliDevice[]> {
  // utmSource e o que o proprio cliente oficial da Cobli manda em toda
  // chamada — serve pra eles saberem de onde vem o trafego da API. Mandamos
  // o nome deste sistema pelo mesmo motivo (e pra facilitar o suporte deles
  // achar nossas chamadas se algo der errado).
  const payload = await cobliFetch(COBLI_ENDPOINTS.dispositivos, { utmSource: "gestao-motoristas" }, deadline);
  const devices: CobliDevice[] = [];
  for (const item of extractList(payload)) {
    const device = parseDevice(item);
    if (device) devices.push(device);
  }
  return devices;
}
