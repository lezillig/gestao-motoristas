// Tipos normalizados da integracao com a Cobli (telemetria/rastreamento da
// frota). Tudo aqui e o formato JA traduzido pro vocabulario do sistema —
// o formato cru da API (nomes de campo, unidades, epoch em milissegundos)
// fica confinado em src/lib/cobli/client.ts.

// Um dispositivo/veiculo rastreado, do jeito que a Cobli devolve na listagem
// do painel (GET herbie-1.1/dash/device). `deviceId` e a chave estavel do
// lado deles (guardada em Vehicle.cobliDeviceId depois do primeiro casamento
// por placa); `plate` e o que casa com o cadastro local na primeira vez.
export type CobliDevice = {
  deviceId: string;
  // Placa ja normalizada (maiuscula, sem hifen/espaco) — nula quando o
  // dispositivo nao tem veiculo vinculado do lado da Cobli (rastreador em
  // estoque, recem-instalado, etc.). Sem placa e sem vinculo previo por
  // deviceId, nao ha como casar com o cadastro local.
  plate: string | null;
  // Nome/apelido do veiculo no painel da Cobli (ex. "Van 12", "ABC1D23") —
  // so pra exibir na lista de "sem vinculo", nunca usado pra casar.
  label: string | null;
  // Ultima posicao conhecida. Nula quando o dispositivo nunca reportou ou a
  // resposta veio sem bloco de posicao — o veiculo entra no relatorio de
  // sincronizacao como "sem posicao", nao vira leitura.
  position: CobliPosition | null;
};

export type CobliPosition = {
  latitude: number;
  longitude: number;
  // km/h. A Cobli reporta velocidade em km/h no painel; leituras negativas
  // ou ausentes viram 0 em vez de descartar a posicao inteira (a posicao
  // ainda vale pro mapa e pro historico).
  speedKmh: number;
  recordedAt: Date;
};

export type CobliApiKeyStatus =
  | { ok: true }
  | { ok: false; status: number; message: string };
