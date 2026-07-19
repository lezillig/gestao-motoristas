import type { ITelemetryProvider } from "./types";
import { MockTelemetryProvider } from "./mockProvider";

export type { ITelemetryProvider, TelemetryReadingInput } from "./types";

// Unico ponto de decisao de qual fornecedor esta ativo. Quando houver
// credenciais da Ituran, troque para "return new IturanProvider(...)" aqui —
// o resto do produto so conhece a interface ITelemetryProvider.
export function getActiveTelemetryProvider(): ITelemetryProvider {
  return new MockTelemetryProvider();
}
