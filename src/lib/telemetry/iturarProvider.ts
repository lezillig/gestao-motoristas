import { prisma } from "@/lib/prisma";
import { fetchVehiclesRealtime } from "@/lib/ituran/client";
import type { ITelemetryProvider, TelemetryFetchProgress, TelemetryReadingInput } from "./types";

export class IturanProvider implements ITelemetryProvider {
  name = "Ituran";

  async fetchReadings(
    vehicleIds: string[],
    onProgress?: (progress: TelemetryFetchProgress) => void
  ): Promise<TelemetryReadingInput[]> {
    if (vehicleIds.length === 0) return [];

    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: vehicleIds } },
      select: { id: true, plate: true },
    });
    const vehicleIdByPlate = new Map(vehicles.map((v) => [v.plate.trim().toUpperCase(), v.id]));

    const snapshots = await fetchVehiclesRealtime(onProgress);

    const readings: TelemetryReadingInput[] = [];
    for (const s of snapshots) {
      const vehicleId = vehicleIdByPlate.get(s.plate);
      if (!vehicleId) continue;
      if (s.latitude == null || s.longitude == null || s.speedKmh == null || !s.recordedAt) continue;
      readings.push({
        vehicleId,
        speedKmh: s.speedKmh,
        latitude: s.latitude,
        longitude: s.longitude,
        recordedAt: s.recordedAt,
        odometerKm: s.odometerKm,
        speedLimitKmh: s.speedLimitKmh,
      });
    }
    return readings;
  }
}
