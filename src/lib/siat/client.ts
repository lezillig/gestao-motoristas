import type {
  SiatDriver,
  SiatDriverRaw,
  SiatReservation,
  SiatReservationRaw,
  SiatScaleAssignment,
  SiatScaleAssignmentRaw,
  SiatVehicle,
  SiatVehicleRaw,
} from "./types";

// URL/autenticacao corrigidas pelo fornecedor em 2026-08-20 — a
// documentacao original (PDF) descrevia /api/entities/{Entity} com header
// api_key, que devolvia 403 "auth_required" mesmo com a chave certa
// (confirmado com curl cru, identico ao exemplo da doc). O formato real,
// testado e funcionando: /api/functions/externalApi?entity=X&api_key=...
// (api_key como query param, nao header), resposta envelopada em
// { entity, company, count, data: [...] } em vez de array puro.
const SIAT_BASE_URL = "https://siat.base44.app/api/functions/externalApi";
const PAGE_SIZE = 500; // maximo documentado
const MAX_RATE_LIMIT_RETRIES = 3;

export function isSiatAvailable(): boolean {
  return Boolean(process.env.SIAT_API_KEY);
}

function apiKey(): string {
  const key = process.env.SIAT_API_KEY;
  if (!key) throw new Error("SIAT_API_KEY não configurada — sincronização com o SIAT indisponível.");
  return key;
}

type SiatResponse<T> = { entity: string; company: string; count: number; data: T[] };

// Limite documentado: 20 requisicoes/minuto. O backoff de 429 abaixo e so
// rede de seguranca — o volume esperado (poucas paginas por entidade) fica
// bem abaixo do limite mesmo sem pacing.
async function siatFetch<T>(
  entity: "Vehicle" | "Driver" | "Reservation" | "ScaleAssignment",
  filter: Record<string, unknown>,
  opts: { limit: number; skip: number },
  attempt = 0
): Promise<T[]> {
  const url = new URL(SIAT_BASE_URL);
  url.searchParams.set("entity", entity);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("limit", String(opts.limit));
  url.searchParams.set("skip", String(opts.skip));
  if (Object.keys(filter).length > 0) url.searchParams.set("q", JSON.stringify(filter));

  const res = await fetch(url);

  if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    const backoffMs = 2000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return siatFetch<T>(entity, filter, opts, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SIAT respondeu ${res.status} em ${entity}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as SiatResponse<T>;
  return data.data ?? [];
}

// A resposta nao traz total geral — pagina ate a pagina voltar com menos
// que `limit` itens.
async function fetchAllPages<T>(entity: "Vehicle" | "Driver" | "Reservation" | "ScaleAssignment", filter: Record<string, unknown>): Promise<T[]> {
  const all: T[] = [];
  let skip = 0;
  for (;;) {
    const page = await siatFetch<T>(entity, filter, { limit: PAGE_SIZE, skip });
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return all;
}

export async function fetchVehicles(): Promise<SiatVehicle[]> {
  const raw = await fetchAllPages<SiatVehicleRaw>("Vehicle", {});
  return raw.map((v) => ({
    id: v.id,
    plate: v.plate.trim().toUpperCase(),
    type: v.type?.trim() || null,
    ownership: v.vehicle_ownership?.trim() || null,
    model: v.model?.trim() || null,
    brand: v.brand?.trim() || null,
    year: v.year ?? null,
    color: v.color?.trim() || null,
    capacity: v.capacity ?? null,
    licensingMonth: v.licensing_month?.trim() || null,
  }));
}

export async function fetchDrivers(): Promise<SiatDriver[]> {
  const raw = await fetchAllPages<SiatDriverRaw>("Driver", {});
  return raw.map((d) => ({
    id: d.id,
    // .trim() — nome real ja visto com tab/espaco extra no fim (ex.
    // "SANDINEIA ALVES \t"), quebra casamento exato se nao aparar.
    name: d.name.trim(),
    cpf: d.cpf?.replace(/\D/g, "") || null,
    phone: d.phone?.trim() || null,
    type: d.type?.trim() || null,
    cnhNumber: d.cnh_number?.trim() || null,
    cnhCategory: d.cnh_category?.trim() || null,
    cnhValidity: d.cnh_validity?.trim().slice(0, 10) || null,
    isActive: d.is_active ?? true,
  }));
}

// Reservation e a fonte real da escala do dia a dia (ver comentario em
// types.ts) — filtra por `date` dia a dia, igual ao import de ponto por
// periodo (a API filtra por igualdade de date, nao por intervalo).
export async function fetchReservations(dateFrom: string, dateTo: string): Promise<SiatReservation[]> {
  const dates: string[] = [];
  for (let d = new Date(`${dateFrom}T00:00:00Z`); d <= new Date(`${dateTo}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const all: SiatReservation[] = [];
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 300));
    const raw = await fetchAllPages<SiatReservationRaw>("Reservation", { date });
    for (const r of raw) {
      all.push({
        id: r.id,
        reservationNumber: r.reservation_number?.trim() || null,
        date: r.date,
        time: r.time,
        clientName: r.client_name?.trim() || null,
        routeName: r.route_name?.trim() || null,
        status: r.status?.trim() || null,
        requestType: r.request_type?.trim().toLowerCase() || null,
        driverId: r.assigned_driver_id ?? null,
        driverName: r.driver_name?.trim() || null,
        vehicleId: r.assigned_vehicle_id ?? null,
        vehicleInfo: r.vehicle_info?.trim() || null,
        endTime: r.trip_end_time?.trim() || null,
        boardingAddress: r.boarding_address?.trim() || r.azul_pickup_address?.trim() || null,
        dropoffAddress: r.dropoff_address?.trim() || r.azul_dropoff_address?.trim() || null,
      });
    }
  }
  return all;
}

// Plantao (turno de disponibilidade do motorista, sem viagem especifica) —
// ver comentario em types.ts sobre os 2 padroes de ScaleAssignment. So
// entram aqui os registros com driver_id E start_datetime preenchidos; os
// demais sao modelo de rota ainda sem motorista atribuido, irrelevantes
// pra escala real. Nao da pra filtrar por data no servidor (o campo `date`
// fica nulo justamente nos registros de Plantao) — busca tudo (volume
// baixo, ~200 registros/empresa) e quem chama filtra pelo periodo
// desejado usando a data local derivada de start_datetime.
export async function fetchScaleAssignments(): Promise<SiatScaleAssignment[]> {
  const raw = await fetchAllPages<SiatScaleAssignmentRaw>("ScaleAssignment", {});
  const result: SiatScaleAssignment[] = [];
  for (const r of raw) {
    if (!r.driver_id || !r.start_datetime) continue;
    result.push({
      id: r.id,
      scaleName: r.scale_name?.trim() || null,
      driverId: r.driver_id,
      driverName: r.driver_name?.trim() || null,
      vehicleId: r.vehicle_id || null,
      vehicleInfo: r.vehicle_info?.trim() || null,
      startDatetime: r.start_datetime,
      endDatetime: r.end_datetime || null,
      routeName: r.route_name?.trim() || null,
      clientName: r.client_name?.trim() || null,
      status: r.status?.trim() || null,
    });
  }
  return result;
}
