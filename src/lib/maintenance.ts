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
