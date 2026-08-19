import type { IturanPosition, IturanVehicle } from "./types";

// Leitura tolerante do payload da Ituran.
//
// Motivo de existir: o contrato de integração da Ituran não é público e o
// nome dos campos varia entre contratos/versões (payload em português ou em
// inglês, envelope `data`/`items`/`posicoes` ou array na raiz, data em ISO ou
// em dd/MM/aaaa, número decimal com vírgula). Em vez de espalhar `as any` e
// checagens ad hoc pelo cliente, todo o "achar o campo certo" fica aqui, em
// funções puras — o resto do código só vê IturanPosition/IturanVehicle.
//
// Regra: campo obrigatório ausente ou ilegível => a linha é descartada
// (retorna null), nunca vira uma leitura com 0 km/h ou coordenada 0,0 — dado
// inventado aqui viraria alerta de velocidade falso lá na frente.

/** Fuso fixo do Brasil. O horário de verão foi extinto em 2019 (Decreto
 * 9.772/2019), então -03:00 vale o ano inteiro — não há ambiguidade a
 * resolver quando a Ituran manda data/hora local sem offset. */
const BRAZIL_UTC_OFFSET = "-03:00";

const PLATE_KEYS = ["placa", "plate", "placaVeiculo", "vehiclePlate", "licensePlate", "placa_veiculo"];
const SPEED_KEYS = ["velocidade", "speed", "speedKmh", "velocidadeKmH", "vel", "velocidade_km_h"];
const LAT_KEYS = ["latitude", "lat"];
const LON_KEYS = ["longitude", "lon", "lng", "long"];
const DATE_KEYS = [
  "dataPosicao",
  "dataHora",
  "dataHoraPosicao",
  "dataEvento",
  "dataGps",
  "data",
  "recordedAt",
  "timestamp",
  "date",
  "gpsDate",
  "dtPosicao",
  "eventDate",
];
const IGNITION_KEYS = ["ignicao", "ignition", "ligado", "igniçao", "ignição"];
const ODOMETER_KEYS = ["hodometro", "odometro", "odometer", "hodometroKm", "odometerKm", "hodômetro", "odômetro"];
const ADDRESS_KEYS = ["endereco", "endereço", "address", "logradouro", "localizacao", "localização"];
const VEHICLE_ID_KEYS = ["id", "idVeiculo", "vehicleId", "codigo", "codigoVeiculo", "veiculoId"];
const DESCRIPTION_KEYS = ["descricao", "descrição", "description", "modelo", "model", "nome", "name", "apelido"];

/** Chaves de envelope usadas por APIs de rastreamento para embrulhar a lista. */
const ARRAY_ENVELOPE_KEYS = [
  "data",
  "items",
  "_items",
  "result",
  "results",
  "content",
  "posicoes",
  "posições",
  "positions",
  "veiculos",
  "veículos",
  "vehicles",
  "registros",
  "lista",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Casa a chave ignorando caixa, acento e separadores (`data_posicao` casa
 * com `dataPosicao`), porque o mesmo campo aparece escrito de formas
 * diferentes conforme o contrato. */
function canonicalKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

/** Indexa o registro uma vez por chave canônica. Vale a pena separar de
 * pick(): uma posição é consultada por ~10 campos, e reconstruir o índice a
 * cada consulta multiplicaria por 10 o custo de ler um lote grande. */
function canonicalRecord(record: Record<string, unknown>): Map<string, unknown> {
  const canonical = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    const normalized = canonicalKey(key);
    // Primeira ocorrência vence — chaves distintas raramente colidem depois
    // de normalizadas, mas se colidirem a ordem do payload decide.
    if (!canonical.has(normalized)) canonical.set(normalized, value);
  }
  return canonical;
}

function pick(record: Map<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record.get(canonicalKey(key));
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/** Aceita número, ou string com vírgula decimal ("82,5" — comum em payload
 * brasileiro) e com separador de milhar. */
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // Só trata ponto como separador de milhar quando há vírgula na string
  // (formato pt-BR "1.234,5"). Sem essa condição, uma coordenada legítima
  // como "-25.428" viraria -25428 — o ponto ali é decimal, não milhar.
  const cleaned = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Hodômetro em km inteiros. Existe separado de parseNumber porque "123.456"
 * é ambíguo: como coordenada o ponto é decimal, como hodômetro em formato
 * pt-BR ele é separador de milhar. parseNumber tem de proteger a coordenada
 * (ler "-25.428" como -25428 poria o veículo no meio do oceano), então aqui,
 * onde a semântica é conhecida, o padrão estrito de grupos de 3 dígitos
 * ("123.456", "1.234.567") é lido como milhar — nenhum hodômetro real é
 * informado com fração de km.
 */
export function parseOdometerKm(value: unknown): number | null {
  const raw = typeof value === "string" ? value.trim() : value;
  const parsed =
    typeof raw === "string" && /^-?\d{1,3}(\.\d{3})+$/.test(raw)
      ? parseNumber(raw.replace(/\./g, ""))
      : parseNumber(raw);
  if (parsed === null || parsed < 0) return null;
  return Math.round(parsed);
}

export function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "sim", "s", "on", "ligada", "ligado"].includes(normalized)) return true;
  if (["0", "false", "nao", "não", "n", "off", "desligada", "desligado"].includes(normalized)) return false;
  return null;
}

/**
 * Normaliza placa para comparação: só letras e dígitos, em maiúsculas. Cobre
 * os dois formatos em circulação — antigo ("ABC-1234") e Mercosul
 * ("ABC1D23") — e o cadastro interno passa pela mesma função antes do
 * casamento, então "abc-1234" da Ituran casa com "ABC1234" do cadastro.
 */
export function normalizePlate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return normalized.length >= 6 ? normalized : null;
}

/**
 * Data/hora de posição em qualquer um dos formatos vistos em APIs de
 * rastreamento brasileiras: ISO com offset, ISO sem offset (assume horário de
 * Brasília), "dd/MM/aaaa HH:mm[:ss]" e epoch em segundos ou milissegundos.
 */
export function parseIturanDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === "number" || (typeof value === "string" && /^\d{9,14}$/.test(value.trim()))) {
    const epoch = typeof value === "number" ? value : Number(value.trim());
    if (!Number.isFinite(epoch)) return null;
    // Menos de 1e12 é segundo (epoch em ms só passou de 1e12 em 2001).
    const date = new Date(epoch < 1e12 ? epoch * 1000 : epoch);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})[ T]?(\d{2})?:?(\d{2})?:?(\d{2})?/.exec(raw);
  if (brazilian) {
    const [, d, m, y, h = "00", min = "00", s = "00"] = brazilian;
    const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}${BRAZIL_UTC_OFFSET}`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(:(\d{2}))?/.exec(raw);
  if (iso) {
    const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(raw);
    // Sem offset explícito o horário é local do rastreador (Brasília). Ler
    // como UTC — o que `new Date("2026-08-19T10:00:00")` faria em Node —
    // jogaria a leitura 3h para trás e desalinharia com a escala/ponto.
    const normalized = hasOffset ? raw.replace(" ", "T") : `${raw.replace(" ", "T")}${BRAZIL_UTC_OFFSET}`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Encontra a lista de registros esteja ela na raiz ou dentro de um envelope
 * (inclusive aninhado um nível, ex.: `{ data: { posicoes: [...] } }`). */
export function extractArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  const indexed = canonicalRecord(payload);
  for (const key of ARRAY_ENVELOPE_KEYS) {
    const value = pick(indexed, [key]);
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  for (const key of ARRAY_ENVELOPE_KEYS) {
    const value = pick(indexed, [key]);
    if (isRecord(value)) {
      const nested = extractArray(value);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

export function parsePosition(raw: Record<string, unknown>): IturanPosition | null {
  const record = canonicalRecord(raw);
  const plate = normalizePlate(pick(record, PLATE_KEYS));
  const latitude = parseNumber(pick(record, LAT_KEYS));
  const longitude = parseNumber(pick(record, LON_KEYS));
  const recordedAt = parseIturanDate(pick(record, DATE_KEYS));
  if (!plate || latitude === null || longitude === null || !recordedAt) return null;

  // Coordenada fora da faixa válida ou exatamente (0,0) é rastreador sem fix
  // de GPS, não uma posição no Golfo da Guiné.
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;

  const speedRaw = parseNumber(pick(record, SPEED_KEYS));
  // Velocidade ausente = veículo parado reportando posição; velocidade
  // negativa é ruído do rastreador e vira 0 (nunca alerta de excesso).
  const speedKmh = speedRaw === null || speedRaw < 0 ? 0 : speedRaw;

  const address = pick(record, ADDRESS_KEYS);

  return {
    plate,
    speedKmh,
    latitude,
    longitude,
    recordedAt,
    ignition: parseBoolean(pick(record, IGNITION_KEYS)),
    odometerKm: parseOdometerKm(pick(record, ODOMETER_KEYS)),
    address: typeof address === "string" && address.trim() ? address.trim() : null,
  };
}

export function parsePositions(payload: unknown): IturanPosition[] {
  const positions: IturanPosition[] = [];
  for (const raw of extractArray(payload)) {
    const position = parsePosition(raw);
    if (position) positions.push(position);
  }
  return positions;
}

export function parseVehicle(raw: Record<string, unknown>): IturanVehicle | null {
  const record = canonicalRecord(raw);
  const plate = normalizePlate(pick(record, PLATE_KEYS));
  if (!plate) return null;
  const externalId = pick(record, VEHICLE_ID_KEYS);
  const description = pick(record, DESCRIPTION_KEYS);
  return {
    plate,
    externalId: externalId === undefined ? null : String(externalId),
    description: typeof description === "string" && description.trim() ? description.trim() : null,
  };
}

export function parseVehicles(payload: unknown): IturanVehicle[] {
  const vehicles: IturanVehicle[] = [];
  for (const raw of extractArray(payload)) {
    const vehicle = parseVehicle(raw);
    if (vehicle) vehicles.push(vehicle);
  }
  return vehicles;
}

/** Token de sessão devolvido pelo endpoint de login, com validade em
 * segundos quando o payload informa. */
export function parseAuthToken(payload: unknown): { token: string; expiresInSeconds: number | null } | null {
  if (typeof payload === "string" && payload.trim()) {
    return { token: payload.trim(), expiresInSeconds: null };
  }
  if (!isRecord(payload)) return null;

  const record = canonicalRecord(payload);
  const token = pick(record, ["token", "access_token", "accessToken", "jwt", "id_token", "sessionId", "chave"]);
  if (typeof token === "string" && token.trim()) {
    const expires = parseNumber(pick(record, ["expires_in", "expiresIn", "expiracao", "expiration", "ttl"]));
    return { token: token.trim(), expiresInSeconds: expires !== null && expires > 0 ? expires : null };
  }

  // Alguns contratos aninham o token dentro de `data`/`result`.
  for (const key of ["data", "result", "content", "retorno"]) {
    const nested = pick(record, [key]);
    if (isRecord(nested) || typeof nested === "string") {
      const found = parseAuthToken(nested);
      if (found) return found;
    }
  }
  return null;
}
