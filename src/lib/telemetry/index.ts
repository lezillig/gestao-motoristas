import type { ITelemetryProvider } from "./types";
import { MockTelemetryProvider } from "./mockProvider";
import { IturanTelemetryProvider } from "./ituranProvider";
import { isIturanConfigured } from "@/lib/ituran/config";

export type {
  ITelemetryProvider,
  TelemetryReadingInput,
  TelemetryVehicleRef,
  TelemetryFetchOptions,
  TelemetryFetchResult,
  TelemetryConnectionStatus,
} from "./types";

// Único ponto de decisão de qual fornecedor está ativo: havendo credenciais
// da Ituran (ITURAN_BASE_URL + token ou usuário/senha), é ela; sem elas, o
// produto continua funcionando com o provedor simulado em vez de quebrar a
// tela de telemetria. O resto do produto só conhece a interface
// ITelemetryProvider.
export function getActiveTelemetryProvider(): ITelemetryProvider {
  if (isIturanConfigured()) return new IturanTelemetryProvider();
  return new MockTelemetryProvider();
}
