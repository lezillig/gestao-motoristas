"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet";

export type TripPoint = {
  id: string;
  startLat: number;
  startLon: number;
  startAddress: string | null;
  startTime: string;
  endLat: number;
  endLon: number;
  endAddress: string | null;
  endTime: string;
};

// So temos os 2 pontos que a Ituran manda por viagem (partida/chegada) —
// nao um historico de posicao ponto a ponto, entao a linha aqui e reta
// (tracejada de proposito) e NAO o trajeto real feito pela rua, ao
// contrario do replay de rota no site da Ituran.
export default function TripMap({ trips }: { trips: TripPoint[] }) {
  if (trips.length === 0) return null;

  const allPoints = trips.flatMap((t) => [
    [t.startLat, t.startLon] as [number, number],
    [t.endLat, t.endLon] as [number, number],
  ]);
  const avgLat = allPoints.reduce((s, p) => s + p[0], 0) / allPoints.length;
  const avgLon = allPoints.reduce((s, p) => s + p[1], 0) / allPoints.length;

  return (
    <div className="flex flex-col gap-1">
      <div className="h-72 w-full overflow-hidden rounded-lg border border-slate-200">
        <MapContainer center={[avgLat, avgLon]} zoom={11} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {trips.map((t) => (
            <div key={t.id}>
              <Polyline positions={[[t.startLat, t.startLon], [t.endLat, t.endLon]]} pathOptions={{ color: "#2563eb", weight: 2, dashArray: "6 6" }} />
              <CircleMarker center={[t.startLat, t.startLon]} radius={6} pathOptions={{ color: "#16a34a", fillColor: "#16a34a", fillOpacity: 1 }}>
                <Tooltip>
                  Partida {t.startTime}
                  {t.startAddress ? ` — ${t.startAddress}` : ""}
                </Tooltip>
              </CircleMarker>
              <CircleMarker center={[t.endLat, t.endLon]} radius={6} pathOptions={{ color: "#dc2626", fillColor: "#dc2626", fillOpacity: 1 }}>
                <Tooltip>
                  Chegada {t.endTime}
                  {t.endAddress ? ` — ${t.endAddress}` : ""}
                </Tooltip>
              </CircleMarker>
            </div>
          ))}
        </MapContainer>
      </div>
      <p className="text-xs text-slate-400">
        <span className="text-emerald-600">●</span> partida · <span className="text-red-600">●</span> chegada — linha reta só pra ligar os 2
        pontos, não é o trajeto real feito pela rua (a Ituran não expõe esse detalhe pra nós, só no site deles).
      </p>
    </div>
  );
}
