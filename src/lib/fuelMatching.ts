// Compartilhado entre a importacao por planilha (combustivel/actions.ts) e
// a sincronizacao via API da Sofit (combustivel/sofitActions.ts) — mesma
// heuristica de casamento veiculo/motorista pras duas fontes.
export function matchVehicleAndDriver(
  placaText: string,
  motoristaText: string,
  vehicleByPlate: Map<string, string>,
  driverByCpf: Map<string, string>,
  driverByName: Map<string, string>
): { vehicleId: string | undefined; driverId: string | undefined } {
  const placaNormalizada = placaText.toUpperCase().replace(/[\s-]/g, "");
  const vehicleId = placaNormalizada ? vehicleByPlate.get(placaNormalizada) : undefined;

  const cpfDigits = motoristaText.replace(/\D/g, "");
  const driverId =
    cpfDigits.length === 11
      ? driverByCpf.get(cpfDigits)
      : motoristaText
        ? driverByName.get(motoristaText.trim().toLowerCase())
        : undefined;

  return { vehicleId, driverId };
}
