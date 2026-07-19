export type TelemetryReadingInput = {
  vehicleId: string;
  speedKmh: number;
  latitude: number;
  longitude: number;
  recordedAt: Date;
};

// Ponto de troca para o fornecedor real: uma IturanProvider (ou Sascar,
// Onixsat...) so precisa implementar esta interface e ser retornada por
// getActiveTelemetryProvider() em index.ts — nenhuma outra camada do produto
// muda quando o fornecedor mudar.
export interface ITelemetryProvider {
  name: string;
  fetchReadings(vehicleIds: string[]): Promise<TelemetryReadingInput[]>;
}
