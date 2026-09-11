import { prisma } from "@/lib/prisma";

// Intervalo preventivo generico para onibus/vans de fretamento. Sem um
// modulo de manutencao completo ainda, isto e propositalmente simples: um
// unico contador por veiculo, resetado manualmente quando a manutencao e
// feita (ver registerMaintenance em /utilizacao/actions.ts).
export const MAINTENANCE_INTERVAL_KM = 10000;

export function kmSinceLastMaintenance(vehicle: { currentMileage: number; lastMaintenanceMileage: number }) {
  return vehicle.currentMileage - vehicle.lastMaintenanceMileage;
}

export function isMaintenanceDue(vehicle: { currentMileage: number; lastMaintenanceMileage: number }) {
  return kmSinceLastMaintenance(vehicle) >= MAINTENANCE_INTERVAL_KM;
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
