// Correcao manual pra placas que a Ituran reporta erradas (license_plate do
// cadastro e das viagens, mesmo valor errado nos dois) — confirmado real
// (2026-08-24): comparamos a frota inteira SIAT x Ituran, achamos pares
// com 1 caractere de diferenca, e testamos contra o banco de producao —
// todos tinham 0 viagens/leituras registradas, porque a placa errada da
// Ituran nunca batia com o nosso cadastro (fonte SIAT, correto). Sem essa
// correcao esses veiculos ficam invisiveis em /telemetria ate a Ituran
// arrumar o cadastro deles (reportado, ver mensagem enviada em 24/08/2026).
// Chave = placa como a Ituran manda, valor = placa correta (como esta no
// nosso cadastro).
//
// 9 entradas REMOVIDAS em 2026-09-09 (BYX8I75, FYA6I84, GBT9I12, GHT7I48,
// SUC8I92, SWA3I34, TKY1I12, SUH4I76, UFQ4I58): confirmado real, comparando
// contra a LW Tecnologia e conferindo direto no cadastro de producao, que a
// frota desses veiculos foi renovada (troca de van, todas ano 2026/0km) e o
// SIAT ja tem a placa Mercosul CORRETA (com letra, ex. "BYX8I75") — a mesma
// que a Ituran ja reporta. A correcao antiga, criada quando o cadastro
// ainda tinha a placa velha, tinha virado o problema: ela reescrevia a
// placa (ja certa) da Ituran para uma placa que nao existe mais em nenhum
// veiculo, fazendo viagens reais serem descartadas silenciosamente em
// src/lib/ituran/tripSync.ts (filtro por placa sem match = viagem ignorada).
// Licao: uma correcao de placa "confirmada real" numa data pode ficar
// obsoleta (e ativamente prejudicial) depois de uma renovacao de frota —
// vale reconferir contra o cadastro atual antes de assumir que uma entrada
// antiga desta tabela ainda é necessária.
const ITURAN_PLATE_CORRECTIONS: Record<string, string> = {
  FKR1I91: "FKR1191",
  // QSV7179 nao e erro de digitacao da Ituran — o SIAT tem esse Ford Ranger
  // cadastrado 2x, com siatId diferentes (QSV7I79, mais antigo/completo, e
  // QSV7179, duplicata sem ano criada em 24/08/2026). Mesclamos tudo no
  // QSV7I79 e apagamos o duplicado; a Ituran continua reportando "QSV7179"
  // (sem I) nas viagens, entao precisa desviar pra onde o historico ficou.
  QSV7179: "QSV7I79",
  BRY3215: "BRY3C15",
  DSI6583: "DSI6F83",
  EOO2333: "EOO2D33",
  FPY4490: "FPY4E90",
  FUG0357: "FUG0D57",
  FVA0545: "FVA0F45",
};

export function correctIturarPlate(plate: string): string {
  return ITURAN_PLATE_CORRECTIONS[plate] ?? plate;
}
