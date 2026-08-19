// Pausa entre chamadas consecutivas à API do Omie.
//
// Ao contrário do TiqueTaque (que documenta um teto explícito de 60 req/min e
// devolve 429), o Omie não publica um número de requisições por minuto: o que
// ele documenta é um bloqueio por "consumo indevido" na combinação
// App Key + IP + método — e o gatilho principal é REPETIR CHAMADA COM ERRO,
// não volume. Na 10ª chamada incorreta seguida do mesmo trio, o bloqueio é de
// 30 minutos (HTTP 425), e cada nova chamada com erro dentro da janela de 60s
// reinicia a contagem, estendendo o bloqueio.
//
// Consequências de desenho, aplicadas em client.ts:
//   1. nunca retentar um erro de negócio (faultstring) — retentar é
//      exatamente o que constrói o bloqueio de 30 minutos;
//   2. pacear as chamadas de paginação mesmo sem erro, com folga.
// 600ms é conservador de propósito: um sync de contas a receber de um mês
// inteiro raramente passa de algumas dezenas de páginas (500 registros por
// página), então o custo total do pace é de segundos, e o risco que ele evita
// é meia hora de integração fora do ar.
export const OMIE_REQUEST_PACE_MS = 600;

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
