"use client";

import dynamic from "next/dynamic";

// Leaflet mexe em `window`/`document` na hora de montar o mapa — nao da pra
// renderizar no servidor. A pagina que usa isso (page.tsx) e Server
// Component, entao o dynamic(..., {ssr:false}) precisa estar aqui, num
// componente cliente, e nao la (Next barra ssr:false direto num Server
// Component).
const TripMap = dynamic(() => import("./TripMap"), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-lg border border-slate-200 bg-slate-50" />,
});

export default TripMap;
