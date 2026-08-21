import { extractPlate } from "@/lib/plate";
import type {
  IturanTokenResponse,
  IturanTrip,
  IturanTripRaw,
  IturanTripsResponse,
  IturanVehicleRaw,
  IturanVehicleSnapshot,
  IturanVehiclesResponse,
} from "./types";

const ITURAN_BASE_URL = "https://api-iweb.ituran.com.br";
const PAGE_SIZE = 100;
const MAX_RATE_LIMIT_RETRIES = 3;

export function isIturanAvailable(): boolean {
  return Boolean(process.env.ITURAN_USERNAME && process.env.ITURAN_PASSWORD);
}

// Sem cache/persistencia de token nesta leva — uso pouco frequente (botao
// manual + 1x/dia via cron), entao busca um token novo a cada chamada em
// vez de guardar/renovar entre invocacoes (mesmo espirito de simplicidade
// do cliente SIAT, que nem token tem). app_id e opcional — confirmado real
// (2026-08-21): a conta da AzulMob autentica normalmente sem ele.
async function getAccessToken(): Promise<string> {
  const username = process.env.ITURAN_USERNAME;
  const password = process.env.ITURAN_PASSWORD;
  const appId = process.env.ITURAN_APP_ID;
  if (!username || !password) {
    throw new Error("Credenciais da Ituran não configuradas (ITURAN_USERNAME/ITURAN_PASSWORD).");
  }

  const res = await fetch(`${ITURAN_BASE_URL}/api/v1/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "password",
      username,
      password,
      ...(appId ? { app_id: Number(appId) } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ituran respondeu ${res.status} ao autenticar: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as IturanTokenResponse;
  if (!data.access_token) throw new Error("Ituran não devolveu access_token.");
  return data.access_token;
}

async function iturarFetch<T>(path: string, params: Record<string, string>, attempt = 0): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${ITURAN_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });

  if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    const backoffMs = 2000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return iturarFetch<T>(path, params, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ituran respondeu ${res.status} em ${path}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// nickname segue o padrao "PLACA - descricao" em toda a frota observada
// (ex. "UPN2F99 - FAB / PERNAMBUCANAS - Mahas") — restringe a extracao ao
// primeiro trecho antes do " - " em vez de buscar em qualquer parte do
// texto, pra nao arriscar casar algo parecido com placa no meio da
// descricao livre.
function mapVehicleSnapshot(v: IturanVehicleRaw): IturanVehicleSnapshot | null {
  const plate = v.license_plate?.trim().toUpperCase() || extractPlate(v.nickname?.split(" - ")[0]);
  if (!plate) return null;
  const loc = v.last_location;
  return {
    plate,
    latitude: loc?.location?.point?.lat ?? null,
    longitude: loc?.location?.point?.lon ?? null,
    speedKmh: loc?.speed ?? null,
    speedLimitKmh: loc?.location?.address?.speedlimit ?? null,
    odometerKm: loc?.odometer ?? null,
    recordedAt: loc?.timestamp ? new Date(loc.timestamp) : null,
  };
}

// Frota inteira numa consulta paginada so (nao precisa de 1 chamada por
// veiculo, ao contrario do TiqueTaque) — realtime_fields=LastLocation traz
// posicao/velocidade/odometro/limite-de-via de cada veiculo de uma vez.
export async function fetchVehiclesRealtime(): Promise<IturanVehicleSnapshot[]> {
  const all: IturanVehicleSnapshot[] = [];
  let page = 1;
  for (;;) {
    if (page > 1) await new Promise((resolve) => setTimeout(resolve, 300));
    const data = await iturarFetch<IturanVehiclesResponse>("/api/v2/vehicles", {
      realtime_fields: "LastLocation",
      page_number: String(page),
      page_size: String(PAGE_SIZE),
    });
    for (const raw of data.vehicles ?? []) {
      const snapshot = mapVehicleSnapshot(raw);
      if (snapshot) all.push(snapshot);
    }
    const pageCount = data.metadata?.pagination?.page_count ?? 1;
    if (page >= pageCount) break;
    page += 1;
  }
  return all;
}

function mapTrip(t: IturanTripRaw): IturanTrip | null {
  const plate = t.license_plate?.trim().toUpperCase();
  const startAtRaw = t.start_location?.timestamp;
  const endAtRaw = t.end_location?.timestamp;
  if (!plate || !startAtRaw || !endAtRaw) return null;
  return {
    iturarTripId: String(t.trip_id),
    plate,
    startAt: new Date(startAtRaw),
    endAt: new Date(endAtRaw),
    distanceKm: t.distance ?? null,
    maxSpeedKmh: t.max_speed ?? null,
    idleMinutes: t.idle_duration_in_minutes ?? null,
    driverNameRaw: t.driver_name?.trim() || null,
  };
}

// Viagens no intervalo (from_date/to_date, "DateTime is in user local
// time" conforme a doc) — paginado, tambem numa consulta so pra frota
// inteira, sem precisar filtrar por placa.
export async function fetchTrips(dateFrom: Date, dateTo: Date): Promise<IturanTrip[]> {
  const all: IturanTrip[] = [];
  let page = 1;
  for (;;) {
    if (page > 1) await new Promise((resolve) => setTimeout(resolve, 300));
    const data = await iturarFetch<IturanTripsResponse>("/api/v2/trips", {
      from_date: dateFrom.toISOString(),
      to_date: dateTo.toISOString(),
      page_number: String(page),
      page_size: String(PAGE_SIZE),
    });
    for (const raw of data.trips ?? []) {
      const trip = mapTrip(raw);
      if (trip) all.push(trip);
    }
    const pageCount = data.metadata?.pagination?.page_count ?? 1;
    if (page >= pageCount) break;
    page += 1;
  }
  return all;
}
