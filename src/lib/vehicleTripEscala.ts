import { format } from "date-fns";

// Mesmo padrao de /utilizacao (src/app/(app)/utilizacao/page.tsx) pra achar
// divergencia veiculo x escala: chave por veiculo+dia, sem exigir horario
// exato. Nao usa overlap fino de horario de proposito — boa parte das
// Escala sincronizadas do SIAT agora tem endTime nulo (reserva sem
// trip_end_time), o que tornaria um overlap de DateTime pouco confiavel e
// geraria falsos "sem escala".
// vehicleId null = Plantao sincronizado do SIAT sem veiculo definido ainda —
// nunca casa com uma VehicleTrip real (que sempre tem vehicleId), entao fica
// de fora do indice em vez de virar uma chave "null_..." sem sentido.
export type EscalaKeyLike = { id: string; vehicleId: string | null; date: Date };
export type VehicleTripLike = { vehicleId: string; startAt: Date };

export function matchEscalaForVehicleTrips<E extends EscalaKeyLike>(
  trips: VehicleTripLike[],
  escalas: E[]
): Map<number, string | null> {
  const escalaByKey = new Map<string, E>();
  for (const e of escalas) {
    if (!e.vehicleId) continue;
    escalaByKey.set(`${e.vehicleId}_${format(e.date, "yyyy-MM-dd")}`, e);
  }

  const result = new Map<number, string | null>();
  trips.forEach((trip, index) => {
    const key = `${trip.vehicleId}_${format(trip.startAt, "yyyy-MM-dd")}`;
    result.set(index, escalaByKey.get(key)?.id ?? null);
  });
  return result;
}
