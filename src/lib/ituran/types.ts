// Formato cru da API da Ituran (snake_case nos parametros de query,
// camelCase no corpo JSON — ver documentacao tecnica em
// https://docs.ituran.com/docs/br--ituran-api-v2, base
// https://api-iweb.ituran.com.br). Os tipos internos (sem sufixo "Raw")
// sao a forma ja normalizada que o resto do codigo consome.

export type IturanTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
};

export type IturanLocationRaw = {
  location?: {
    point?: { lat: number; lon: number };
    address?: { location?: string; speedlimit?: number };
  };
  odometer?: number | null;
  speed?: number | null;
  heading?: number | null;
  timestamp?: string | null;
};

export type IturanVehicleRaw = {
  // Confirmado real (2026-08-21): license_plate vem vazio em toda a frota —
  // a placa mora dentro de "nickname" (ex. "UPN2F99 - FAB / PERNAMBUCANAS -
  // Mahas"), extraida via src/lib/plate.ts.
  license_plate?: string | null;
  nickname?: string | null;
  vehicle_id?: number | null;
  motion_status?: string;
  last_location?: IturanLocationRaw;
};

export type IturanVehiclesResponse = {
  metadata?: { pagination?: { page_number: number; page_size: number; total_count: number; page_count: number } };
  vehicles?: IturanVehicleRaw[] | null;
};

export type IturanVehicleSnapshot = {
  plate: string;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number | null;
  speedLimitKmh: number | null;
  odometerKm: number | null;
  recordedAt: Date | null;
};

export type IturanTripRaw = {
  trip_id: number;
  license_plate?: string | null;
  driver_code?: number | null;
  driver_name?: string | null;
  // Mesmo formato do last_location do veiculo (confirmado real,
  // 2026-09-04: start_location/end_location de /v2/trips tem
  // location.point.{lat,lon} e location.address.location, alem do
  // timestamp) — so que ate agora so extraiamos o timestamp e jogavamos o
  // resto fora.
  start_location?: IturanLocationRaw;
  end_location?: IturanLocationRaw;
  duration_in_seconds?: number;
  distance?: number | null;
  max_speed?: number | null;
  idle_duration_in_minutes?: number;
};

export type IturanTripsResponse = {
  metadata?: { pagination?: { page_number: number; page_size: number; total_count: number; page_count: number } };
  trips?: IturanTripRaw[] | null;
};

export type IturanTrip = {
  iturarTripId: string;
  plate: string;
  startAt: Date;
  endAt: Date;
  distanceKm: number | null;
  maxSpeedKmh: number | null;
  idleMinutes: number | null;
  driverNameRaw: string | null;
  startLat: number | null;
  startLon: number | null;
  startAddress: string | null;
  endLat: number | null;
  endLon: number | null;
  endAddress: string | null;
};
