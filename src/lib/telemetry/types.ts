// Veiculo do cadastro local, no minimo que um fornecedor de telemetria
// precisa pra reconhecer o que e o que do lado dele: a placa (criterio de
// casamento na primeira vez) e o id do dispositivo ja vinculado
// (`cobliDeviceId`, criterio estavel depois disso — ver o model Vehicle no
// schema). Fornecedor simulado ignora os dois.
export type TelemetryVehicleRef = {
  id: string;
  plate: string;
  cobliDeviceId: string | null;
};

export type TelemetryReadingInput = {
  vehicleId: string;
  speedKmh: number;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  // Id do dispositivo no fornecedor, quando ele expoe um. A sincronizacao
  // usa isto pra gravar o vinculo em Vehicle.cobliDeviceId na primeira vez
  // que casa por placa, pra que as proximas nao dependam mais de placa
  // (que muda de veiculo, e escrita errada, etc.).
  externalDeviceId?: string | null;
};

// Dispositivo que o fornecedor devolveu mas que nao virou leitura, com o
// motivo — e o que a tela de telemetria mostra pra explicar diferenca entre
// "a Cobli tem 40 rastreadores" e "entraram 33 leituras".
export type TelemetryUnmatchedDevice = {
  externalDeviceId: string;
  plate: string | null;
  label: string | null;
  // "veiculo_inativo" e diferente de "sem_veiculo_no_cadastro": a placa
  // existe no cadastro, so esta com status INATIVO (veiculo vendido, baixado
  // ou fora de operacao) e por isso nao entra na sincronizacao. Dizer
  // "sem veiculo no cadastro" nesse caso mandaria alguem procurar um
  // cadastro que ja existe.
  reason: "sem_veiculo_no_cadastro" | "veiculo_inativo" | "sem_posicao";
};

export type TelemetryFetchResult = {
  readings: TelemetryReadingInput[];
  unmatched: TelemetryUnmatchedDevice[];
};

// Ponto de troca do fornecedor real: uma CobliTelemetryProvider (ou Ituran,
// Sascar, Onixsat...) so precisa implementar esta interface e ser retornada
// por getActiveTelemetryProvider() em index.ts — nenhuma outra camada do
// produto muda quando o fornecedor mudar.
export interface ITelemetryProvider {
  name: string;
  // false = dado inventado (fornecedor simulado). A UI usa isto pra nao
  // deixar ninguem confundir leitura de demonstracao com posicao real.
  real: boolean;
  fetchReadings(vehicles: TelemetryVehicleRef[]): Promise<TelemetryFetchResult>;
}
