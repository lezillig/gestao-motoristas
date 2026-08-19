import type { ITelemetryProvider } from "./types";
import { MockTelemetryProvider } from "./mockProvider";
import { isCobliAvailable } from "@/lib/cobli/client";
import { CobliTelemetryProvider } from "@/lib/cobli/provider";

export type {
  ITelemetryProvider,
  TelemetryReadingInput,
  TelemetryVehicleRef,
  TelemetryFetchResult,
  TelemetryUnmatchedDevice,
} from "./types";

// Unico ponto de decisao de qual fornecedor esta ativo: com COBLI_API_KEY
// configurada, a telemetria vem da Cobli; sem ela, o fornecedor simulado
// continua rodando pra demonstracao (e pra nao deixar a tela vazia em
// ambiente de desenvolvimento). O resto do produto so conhece a interface
// ITelemetryProvider.
//
// `deadline` (timestamp absoluto comparavel com Date.now()) so importa pra
// quem roda com teto duro de execucao — a rota de cron na Vercel; ver
// src/lib/cobli/client.ts.
export function getActiveTelemetryProvider(deadline?: number): ITelemetryProvider {
  if (isCobliAvailable()) return new CobliTelemetryProvider(deadline);
  return new MockTelemetryProvider();
}
