/** Veículo como a Ituran o conhece — a placa é a chave de casamento com o
 * cadastro interno (Vehicle.plate), já normalizada (ver normalizePlate). */
export type IturanVehicle = {
  plate: string;
  /** Id do veículo no lado da Ituran, quando o payload traz. */
  externalId: string | null;
  description: string | null;
};

/** Uma posição/leitura de telemetria já normalizada a partir do payload cru. */
export type IturanPosition = {
  plate: string;
  speedKmh: number;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  ignition: boolean | null;
  odometerKm: number | null;
  address: string | null;
};
