import type { ITelemetryProvider } from "./types";
import { MockTelemetryProvider } from "./mockProvider";
import { IturanProvider } from "./iturarProvider";
import { isIturanAvailable } from "@/lib/ituran/client";

export type { ITelemetryProvider, TelemetryReadingInput } from "./types";

// Unico ponto de decisao de qual fornecedor esta ativo — o resto do
// produto so conhece a interface ITelemetryProvider. Sem credenciais da
// Ituran configuradas (ITURAN_USERNAME/ITURAN_PASSWORD/ITURAN_APP_ID),
// cai pro mock — mesmo padrao de fallback gracioso de isSiatAvailable()/
// isTiqueTaqueAvailable().
export function getActiveTelemetryProvider(): ITelemetryProvider {
  return isIturanAvailable() ? new IturanProvider() : new MockTelemetryProvider();
}
