import { prisma } from "@/lib/prisma";
import { isSpeeding } from "@/lib/speedCompliance";
import { getActiveTelemetryProvider } from "./index";
import type { ITelemetryProvider } from "./types";

export type TelemetrySyncResult = {
  provider: string;
  live: boolean;
  vehicles: number;
  /** Leituras devolvidas pelo provedor (já filtradas/amostradas por ele). */
  fetched: number;
  created: number;
  /** Leituras já existentes no banco — reimportar o mesmo período é seguro. */
  duplicates: number;
  speeding: number;
  unknownPlates: string[];
  since: Date;
  until: Date;
};

/** Quanto tempo para trás buscar quando a empresa ainda não tem nenhuma
 * leitura gravada deste fornecedor. */
const FIRST_SYNC_WINDOW_HOURS = 24;

/**
 * Núcleo do sincronismo de telemetria, sem checagem de sessão/autorização —
 * quem chama (Server Action autenticada por role, ou rota de cron
 * autenticada por secret) é responsável por verificar permissão antes.
 * Mesmo desenho da importação do TiqueTaque (src/lib/tiquetaque/importCore.ts).
 *
 * É incremental: parte da última leitura já gravada do fornecedor ativo, de
 * forma que rodar de novo no mesmo dia só traz o que faltava. O índice único
 * (vehicleId, recordedAt, provider) mais o `skipDuplicates` garantem que uma
 * janela sobreposta nunca duplique linha.
 */
export async function syncTelemetryForCompany(
  companyId: string,
  options: { provider?: ITelemetryProvider; deadline?: number } = {}
): Promise<TelemetrySyncResult> {
  const provider = options.provider ?? getActiveTelemetryProvider();
  const until = new Date();

  const vehicles = await prisma.vehicle.findMany({
    where: { companyId, status: { not: "INATIVO" } },
    select: { id: true, plate: true },
  });

  const lastReading = await prisma.telemetryReading.findFirst({
    where: { companyId, provider: provider.name },
    orderBy: { recordedAt: "desc" },
    select: { recordedAt: true },
  });
  const since = lastReading?.recordedAt ?? new Date(until.getTime() - FIRST_SYNC_WINDOW_HOURS * 3_600_000);

  const empty: TelemetrySyncResult = {
    provider: provider.name,
    live: provider.live,
    vehicles: vehicles.length,
    fetched: 0,
    created: 0,
    duplicates: 0,
    speeding: 0,
    unknownPlates: [],
    since,
    until,
  };
  if (vehicles.length === 0) return empty;

  const { readings, unknownPlates } = await provider.fetchReadings(vehicles, {
    since,
    until,
    deadline: options.deadline,
  });
  if (readings.length === 0) return { ...empty, unknownPlates };

  const { count } = await prisma.telemetryReading.createMany({
    data: readings.map((r) => ({
      companyId,
      vehicleId: r.vehicleId,
      speedKmh: r.speedKmh,
      latitude: r.latitude,
      longitude: r.longitude,
      recordedAt: r.recordedAt,
      provider: provider.name,
      ignition: r.ignition ?? null,
      odometerKm: r.odometerKm ?? null,
      address: r.address ?? null,
    })),
    skipDuplicates: true,
  });

  return {
    ...empty,
    fetched: readings.length,
    created: count,
    duplicates: readings.length - count,
    speeding: readings.filter((r) => isSpeeding(r)).length,
    unknownPlates,
  };
}
