import { IturanClient } from "@/lib/ituran/client";
import { normalizePlate } from "@/lib/ituran/parse";
import type { IturanPosition } from "@/lib/ituran/types";
import { SPEED_LIMIT_KMH } from "@/lib/speedCompliance";
import type {
  ITelemetryProvider,
  TelemetryConnectionStatus,
  TelemetryFetchOptions,
  TelemetryFetchResult,
  TelemetryReadingInput,
  TelemetryVehicleRef,
} from "./types";

/** Janela padrão quando o chamador não informa `since` — ver sync.ts, que
 * normalmente passa a data da última leitura já gravada. */
const DEFAULT_WINDOW_HOURS = 24;
/** Teto de janela por sincronismo. Uma conta parada há semanas pediria de
 * volta um histórico gigante numa invocação só e estouraria o tempo da
 * função; o cron do dia seguinte continua de onde este parar. */
const MAX_WINDOW_HOURS = 24 * 7;

/**
 * Intervalo mínimo entre duas leituras gravadas do mesmo veículo. O
 * rastreador reporta posição a cada poucos segundos: gravar tudo encheria a
 * tabela com dezenas de milhares de linhas por dia sem acrescentar nada ao
 * que o produto faz com o dado (alerta de velocidade e último ponto
 * conhecido). Toda posição acima do limite legal é gravada de qualquer
 * forma — essas são exatamente as que viram alerta e prova.
 */
const MIN_MINUTES_BETWEEN_READINGS = 5;

export function downsamplePositions(
  positions: IturanPosition[],
  minMinutesBetweenReadings = MIN_MINUTES_BETWEEN_READINGS,
  speedLimitKmh = SPEED_LIMIT_KMH
): IturanPosition[] {
  const byPlate = new Map<string, IturanPosition[]>();
  for (const position of positions) {
    const list = byPlate.get(position.plate);
    if (list) list.push(position);
    else byPlate.set(position.plate, [position]);
  }

  const kept: IturanPosition[] = [];
  const minGapMs = minMinutesBetweenReadings * 60_000;
  for (const list of byPlate.values()) {
    const sorted = [...list].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    let lastKeptAt: number | null = null;
    for (const position of sorted) {
      const at = position.recordedAt.getTime();
      const speeding = position.speedKmh > speedLimitKmh;
      if (lastKeptAt !== null && !speeding && at - lastKeptAt < minGapMs) continue;
      kept.push(position);
      lastKeptAt = at;
    }
  }
  return kept;
}

export class IturanTelemetryProvider implements ITelemetryProvider {
  name = "Ituran";
  live = true;

  private readonly client: IturanClient;

  constructor(client?: IturanClient) {
    this.client = client ?? new IturanClient();
  }

  async fetchReadings(
    vehicles: TelemetryVehicleRef[],
    options: TelemetryFetchOptions = {}
  ): Promise<TelemetryFetchResult> {
    if (vehicles.length === 0) return { readings: [], unknownPlates: [] };

    const until = options.until ?? new Date();
    const requestedSince = options.since ?? new Date(until.getTime() - DEFAULT_WINDOW_HOURS * 3_600_000);
    const oldestAllowed = new Date(until.getTime() - MAX_WINDOW_HOURS * 3_600_000);
    const since = requestedSince < oldestAllowed ? oldestAllowed : requestedSince;

    const positions = await this.client.listPositions({ since, until, deadline: options.deadline });

    // Casamento por placa normalizada dos dois lados — o cadastro guarda a
    // placa como o usuário digitou ("ABC-1234"), a Ituran devolve no formato
    // dela, e sem normalizar nada casaria.
    const vehicleByPlate = new Map<string, TelemetryVehicleRef>();
    for (const vehicle of vehicles) {
      const plate = normalizePlate(vehicle.plate);
      if (plate) vehicleByPlate.set(plate, vehicle);
    }

    const readings: TelemetryReadingInput[] = [];
    const unknownPlates = new Set<string>();
    for (const position of downsamplePositions(positions)) {
      const vehicle = vehicleByPlate.get(position.plate);
      if (!vehicle) {
        unknownPlates.add(position.plate);
        continue;
      }
      readings.push({
        vehicleId: vehicle.id,
        speedKmh: position.speedKmh,
        latitude: position.latitude,
        longitude: position.longitude,
        recordedAt: position.recordedAt,
        ignition: position.ignition,
        odometerKm: position.odometerKm,
        address: position.address,
      });
    }

    return { readings, unknownPlates: [...unknownPlates].sort() };
  }

  async checkConnection(): Promise<TelemetryConnectionStatus> {
    const result = await this.client.checkConnection();
    return { ok: result.ok, message: result.message };
  }
}
