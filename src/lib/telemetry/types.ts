/** Veículo do cadastro interno como o provedor precisa vê-lo: o id é a chave
 * do nosso banco, a placa é a chave que o rastreador conhece. */
export type TelemetryVehicleRef = {
  id: string;
  plate: string;
};

export type TelemetryReadingInput = {
  vehicleId: string;
  speedKmh: number;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  /** Campos que só um provedor real preenche (o simulado deixa nulo). */
  ignition?: boolean | null;
  odometerKm?: number | null;
  address?: string | null;
};

export type TelemetryFetchOptions = {
  /** Janela consultada. Sem `since`, o provedor decide um padrão (ver o
   * cálculo incremental em sync.ts). */
  since?: Date;
  until?: Date;
  /** Timestamp absoluto de teto de execução, repassado ao cliente HTTP para
   * ele não gastar backoff além do limite da invocação. */
  deadline?: number;
};

export type TelemetryFetchResult = {
  readings: TelemetryReadingInput[];
  /** Placas monitoradas pelo provedor que não existem no cadastro de
   * veículos. Não é erro — é sinal de cadastro desatualizado, e a tela de
   * telemetria mostra para o gestor resolver. */
  unknownPlates: string[];
};

export type TelemetryConnectionStatus = {
  ok: boolean;
  message: string;
};

// Ponto de troca do fornecedor: uma Sascar/Onixsat só precisa implementar
// esta interface e ser retornada por getActiveTelemetryProvider() em
// index.ts — nenhuma outra camada do produto muda quando o fornecedor mudar.
// A implementação da Ituran está em ituranProvider.ts.
export interface ITelemetryProvider {
  name: string;
  /** false no provedor simulado — a UI usa isso para não vender dado de
   * demonstração como se fosse rastreamento real. */
  live: boolean;
  fetchReadings(
    vehicles: TelemetryVehicleRef[],
    options?: TelemetryFetchOptions
  ): Promise<TelemetryFetchResult>;
  checkConnection(): Promise<TelemetryConnectionStatus>;
}
