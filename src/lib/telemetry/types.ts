export type TelemetryReadingInput = {
  vehicleId: string;
  speedKmh: number;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  // So a Ituran preenche — mock e leituras antigas ficam nulas.
  odometerKm?: number | null;
  speedLimitKmh?: number | null;
};

export type TelemetryFetchProgress = { page: number; pageCount: number };

// Ponto de troca para o fornecedor real: uma IturanProvider (ou Sascar,
// Onixsat...) so precisa implementar esta interface e ser retornada por
// getActiveTelemetryProvider() em index.ts — nenhuma outra camada do produto
// muda quando o fornecedor mudar. onProgress e opcional e so tem sentido pra
// fornecedores paginados (Ituran) — o mock ignora.
export interface ITelemetryProvider {
  name: string;
  fetchReadings(
    vehicleIds: string[],
    onProgress?: (progress: TelemetryFetchProgress) => void
  ): Promise<TelemetryReadingInput[]>;
}
