import type {
  ITelemetryProvider,
  TelemetryConnectionStatus,
  TelemetryFetchResult,
  TelemetryVehicleRef,
} from "./types";

// Provedor de demonstração, usado enquanto não houver credenciais da Ituran
// configuradas (ver ../ituran/config.ts). Gera uma leitura "agora" por
// veículo, com uma chance de simular excesso de velocidade para que o motor
// de alerta (src/lib/speedCompliance.ts) tenha o que detectar em
// demonstrações — não usa dado real de GPS.
const BASE_LAT = -25.4284; // Curitiba, como referencia de regiao de operacao
const BASE_LNG = -49.2733;

export class MockTelemetryProvider implements ITelemetryProvider {
  name = "Simulado (mock)";
  live = false;

  async fetchReadings(vehicles: TelemetryVehicleRef[]): Promise<TelemetryFetchResult> {
    const now = new Date();
    const readings = vehicles.map((vehicle) => {
      const speeding = Math.random() < 0.3;
      const speedKmh = speeding
        ? 101 + Math.round(Math.random() * 25)
        : 60 + Math.round(Math.random() * 35);
      return {
        vehicleId: vehicle.id,
        speedKmh,
        latitude: BASE_LAT + (Math.random() - 0.5) * 0.2,
        longitude: BASE_LNG + (Math.random() - 0.5) * 0.2,
        recordedAt: now,
      };
    });
    return { readings, unknownPlates: [] };
  }

  async checkConnection(): Promise<TelemetryConnectionStatus> {
    return {
      ok: true,
      message: "Provedor simulado ativo — sem credenciais da Ituran configuradas.",
    };
  }
}
