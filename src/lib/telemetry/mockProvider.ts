import type { ITelemetryProvider, TelemetryReadingInput } from "./types";

// Sem credenciais da Ituran ainda (ver blueprint Fase 1). Gera uma leitura
// "agora" por veiculo, com uma chance de simular excesso de velocidade para
// que o motor de alerta (src/lib/speedCompliance.ts) tenha o que detectar em
// demonstracoes — nao usa dado real de GPS.
const BASE_LAT = -25.4284; // Curitiba, como referencia de regiao de operacao
const BASE_LNG = -49.2733;

export class MockTelemetryProvider implements ITelemetryProvider {
  name = "Simulado (mock)";

  async fetchReadings(vehicleIds: string[]): Promise<TelemetryReadingInput[]> {
    const now = new Date();
    return vehicleIds.map((vehicleId) => {
      const speeding = Math.random() < 0.3;
      const speedKmh = speeding
        ? 101 + Math.round(Math.random() * 25)
        : 60 + Math.round(Math.random() * 35);
      return {
        vehicleId,
        speedKmh,
        latitude: BASE_LAT + (Math.random() - 0.5) * 0.2,
        longitude: BASE_LNG + (Math.random() - 0.5) * 0.2,
        recordedAt: now,
      };
    });
  }
}
