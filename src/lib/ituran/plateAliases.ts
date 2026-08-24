// Correcao manual pra placas que a Ituran reporta erradas (license_plate do
// cadastro e das viagens, mesmo valor errado nos dois) — confirmado real
// (2026-08-24): comparamos a frota inteira SIAT x Ituran, achamos 16 pares
// com 1 caractere de diferenca, e testamos contra o banco de producao —
// TODOS os 16 tinham 0 viagens/leituras registradas, porque a placa errada
// da Ituran nunca batia com o nosso cadastro (fonte SIAT, correto). Sem essa
// correcao esses veiculos ficam invisiveis em /telemetria ate a Ituran
// arrumar o cadastro deles (reportado, ver mensagem enviada em 24/08/2026).
// Chave = placa como a Ituran manda, valor = placa correta (como esta no
// nosso cadastro).
const ITURAN_PLATE_CORRECTIONS: Record<string, string> = {
  BYX8I75: "BYX8175",
  FKR1I91: "FKR1191",
  FYA6I84: "FYA6184",
  GBT9I12: "GBT9112",
  GHT7I48: "GHT7148",
  QSV7I79: "QSV7179",
  SUC8I92: "SUC8192",
  SUH4I76: "SUH4176",
  SWA3I34: "SWA3134",
  TKY1I12: "TKY1112",
  UFQ4I58: "UFQ4158",
  BRY3215: "BRY3C15",
  DSI6583: "DSI6F83",
  EOO2333: "EOO2D33",
  FPY4490: "FPY4E90",
  FVA0545: "FVA0F45",
};

export function correctIturarPlate(plate: string): string {
  return ITURAN_PLATE_CORRECTIONS[plate] ?? plate;
}
