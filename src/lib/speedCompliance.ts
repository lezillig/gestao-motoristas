// Limite generico de rodovia para onibus/vans de fretamento (art. 61 CTB e
// Res. CONTRAN correlatas). Fica como constante unica por simplicidade —
// limites por trecho/tipo de via exigiriam dado de rota que nao temos ainda.
export const SPEED_LIMIT_KMH = 100;

export type SpeedReadingLike = {
  id: string;
  vehicleId: string;
  speedKmh: number;
  recordedAt: Date;
};

export function isSpeeding(reading: Pick<SpeedReadingLike, "speedKmh">, limit = SPEED_LIMIT_KMH) {
  return reading.speedKmh > limit;
}

export function findSpeedAlerts<T extends SpeedReadingLike>(readings: T[], limit = SPEED_LIMIT_KMH) {
  return readings.filter((r) => isSpeeding(r, limit));
}
