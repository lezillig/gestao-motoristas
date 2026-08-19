export type LatLon = [number, number];

const EARTH_RADIUS_METERS = 6371000;

// Formula de haversine — distancia em linha reta entre 2 pontos lat/lon,
// em metros. Precisao suficiente pra comparar batida de ponto x local
// esperado (nao precisa de distancia por rota real).
export function distanceMeters(a: LatLon, b: LatLon): number {
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
