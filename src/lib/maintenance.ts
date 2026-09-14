import { prisma } from "@/lib/prisma";

// Intervalo preventivo generico, usado so quando a Sofit nao informa o
// intervalo do proprio veiculo (Vehicle.manutencaoIntervaloKm, sincronizado
// de la desde 2026-09-13 — ex.: 15.000 km pra Renault Master). A "ultima
// manutencao" tambem vem da Sofit (ultima OS de revisao concluida, ver
// lib/sofit/manutencaoSync.ts), com o botao manual de /utilizacao como
// alternativa.
export const MAINTENANCE_INTERVAL_KM = 10000;

export type VehicleMaintenanceLike = {
  currentMileage: number;
  lastMaintenanceMileage: number;
  manutencaoIntervaloKm?: number | null;
  sofitOdometroKm?: number | null;
};

export function maintenanceIntervalKm(vehicle: Pick<VehicleMaintenanceLike, "manutencaoIntervaloKm">): number {
  return vehicle.manutencaoIntervaloKm && vehicle.manutencaoIntervaloKm > 0 ? vehicle.manutencaoIntervaloKm : MAINTENANCE_INTERVAL_KM;
}

// Km atual = o maior entre o hodometro da Ituran (currentMileage) e o da
// Sofit — as duas fontes sao reais, so atualizam em momentos diferentes.
export function currentKm(vehicle: Pick<VehicleMaintenanceLike, "currentMileage" | "sofitOdometroKm">): number {
  return Math.max(vehicle.currentMileage, vehicle.sofitOdometroKm ?? 0);
}

export function kmSinceLastMaintenance(vehicle: VehicleMaintenanceLike) {
  return currentKm(vehicle) - vehicle.lastMaintenanceMileage;
}

export function isMaintenanceDue(vehicle: VehicleMaintenanceLike) {
  return kmSinceLastMaintenance(vehicle) >= maintenanceIntervalKm(vehicle);
}

// Atualiza Vehicle.currentMileage a partir do hodometro real da Ituran —
// decisao do usuario (2026-09-11): manutencao nao deve mais depender de
// alguem digitar km final no check-in manual de /utilizacao (ver
// comentario em src/app/(app)/utilizacao/actions.ts). So sobe (nunca
// desce, `currentMileage: { lt: km }` no where) pra uma leitura antiga ou
// com hodometro errado nao "voltar no tempo" o contador. Chamado sempre
// que uma leitura de telemetria e gerada — tanto pelo botao manual
// (api/telemetria/gerar-leituras) quanto pelo cron diario
// (api/cron/ituran-import).
export async function updateVehicleMileageFromReadings(
  readings: { vehicleId: string; odometerKm?: number | null }[]
): Promise<void> {
  const maiorPorVeiculo = new Map<string, number>();
  for (const r of readings) {
    if (r.odometerKm == null) continue;
    const km = Math.round(r.odometerKm);
    if (km > (maiorPorVeiculo.get(r.vehicleId) ?? 0)) maiorPorVeiculo.set(r.vehicleId, km);
  }
  await Promise.all(
    [...maiorPorVeiculo.entries()].map(([vehicleId, km]) =>
      prisma.vehicle.updateMany({ where: { id: vehicleId, currentMileage: { lt: km } }, data: { currentMileage: km } })
    )
  );
}
