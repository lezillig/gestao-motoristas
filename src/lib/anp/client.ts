import ExcelJS from "exceljs";
import { startOfWeek, endOfWeek, format } from "date-fns";

// Mapa fixo dos 27 nomes de UF por extenso exatamente como a ANP escreve na
// aba "ESTADOS" da planilha (maiusculo, sem acento) — confirmado lendo um
// arquivo real, nao documentacao.
export const UF_BY_ESTADO_NOME: Record<string, string> = {
  ACRE: "AC",
  ALAGOAS: "AL",
  AMAPA: "AP",
  AMAZONAS: "AM",
  BAHIA: "BA",
  CEARA: "CE",
  "DISTRITO FEDERAL": "DF",
  "ESPIRITO SANTO": "ES",
  GOIAS: "GO",
  MARANHAO: "MA",
  "MATO GROSSO": "MT",
  "MATO GROSSO DO SUL": "MS",
  "MINAS GERAIS": "MG",
  PARA: "PA",
  PARAIBA: "PB",
  PARANA: "PR",
  PERNAMBUCO: "PE",
  PIAUI: "PI",
  "RIO DE JANEIRO": "RJ",
  "RIO GRANDE DO NORTE": "RN",
  "RIO GRANDE DO SUL": "RS",
  RONDONIA: "RO",
  RORAIMA: "RR",
  "SANTA CATARINA": "SC",
  "SAO PAULO": "SP",
  SERGIPE: "SE",
  TOCANTINS: "TO",
};

// Os 7 produtos exatamente como aparecem na coluna PRODUTO da planilha real
// da ANP (confirmado lendo o arquivo, nao documentacao).
export type AnpProduto =
  | "ETANOL HIDRATADO"
  | "GASOLINA COMUM"
  | "GASOLINA ADITIVADA"
  | "OLEO DIESEL"
  | "OLEO DIESEL S10"
  | "GLP"
  | "GNV";

// Casa o texto livre do campo "Combustivel" da planilha de extrato (ex.
// "Diesel S10", "Gasolina Aditivada") contra os produtos da ANP. Sem match
// (ex. combustivel nao informado, ou um texto nao reconhecido) devolve
// null — a transacao so fica de fora da comparacao de preco, nao e erro.
export function normalizeProduto(texto: string): AnpProduto | null {
  const t = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // remove acentos (marcas diacriticas apos NFD)
  if (t.includes("diesel") && t.includes("s10")) return "OLEO DIESEL S10";
  if (t.includes("diesel")) return "OLEO DIESEL";
  if (t.includes("gasolina") && t.includes("aditiv")) return "GASOLINA ADITIVADA";
  if (t.includes("gasolina")) return "GASOLINA COMUM";
  if (t.includes("etanol") || t.includes("alcool")) return "ETANOL HIDRATADO";
  if (t.includes("glp")) return "GLP";
  if (t.includes("gnv")) return "GNV";
  return null;
}

// A janela da ANP e sempre domingo-a-sabado — confirmado batendo o nome do
// arquivo (ex. "2026-07-12_2026-07-18") contra as datas internas da
// planilha real.
export function anpWeekRange(date: Date): { start: Date; end: Date } {
  return {
    start: startOfWeek(date, { weekStartsOn: 0 }),
    end: endOfWeek(date, { weekStartsOn: 0 }),
  };
}

function anpFileUrl(start: Date, end: Date, ano: number): string {
  const s = format(start, "yyyy-MM-dd");
  const e = format(end, "yyyy-MM-dd");
  return `https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/arquivos-lpc/${ano}/resumo_semanal_lpc_${s}_${e}.xlsx`;
}

// municipio: "" pra linha de media do ESTADO (aba ESTADOS), nome do
// municipio (maiusculo, sem acento) pra linha de media do MUNICIPIO (aba
// MUNICIPIOS) — ver comentario do model AnpPrecoReferencia sobre o porque
// de "" e nao null.
export type AnpPriceRow = { uf: string; municipio: string; produto: AnpProduto; precoMedioCents: number };

function normalizeAnpText(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

// Busca e parseia o arquivo publico da ANP pra uma semana especifica.
// Devolve null (em vez de lancar erro) quando o arquivo ainda nao foi
// publicado (semana futura, atraso por feriado, etc.) — a sincronizacao
// que chama isto e best-effort, uma semana faltando nao trava as outras.
//
// Le as 2 abas do mesmo arquivo ja baixado — ESTADOS (media por UF) e
// MUNICIPIOS (media por cidade, quando a ANP tem posto pesquisado la; nem
// todo municipio brasileiro tem amostra). Comparar o preco pago contra a
// media do MUNICIPIO e muito mais proximo do posto real de abastecimento
// do que a media do ESTADO inteiro — a media estadual fica so como
// fallback pra cidade que a ANP nao pesquisa.
export async function fetchAnpWeek(start: Date, end: Date): Promise<AnpPriceRow[] | null> {
  // A pasta e pelo ano em que a planilha foi PUBLICADA, nao o ano em que a
  // semana comeca — confirmado real (2026-09-05) que a semana 28/12/2025 a
  // 03/01/2026 mora em .../2026/..., nao .../2025/... Tenta o ano de fim
  // primeiro (cobre o caso comum E a virada de ano), cai pro ano de inicio
  // se nao achar (variacao ja vista ao vivo em torno de outras viradas).
  let res = await fetch(anpFileUrl(start, end, end.getFullYear()));
  if (!res.ok && end.getFullYear() !== start.getFullYear()) {
    res = await fetch(anpFileUrl(start, end, start.getFullYear()));
  }
  if (!res.ok) return null;

  const buffer = Buffer.from(await res.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const rows: AnpPriceRow[] = [];

  const estadosSheet = workbook.getWorksheet("ESTADOS");
  estadosSheet?.eachRow((row, rowNumber) => {
    if (rowNumber <= 10) return; // linhas 1-10 sao cabecalho/metadados
    const estadoNome = normalizeAnpText(row.getCell(4).value);
    const produtoNome = normalizeAnpText(row.getCell(5).value);
    const precoMedio = row.getCell(8).value;
    const uf = UF_BY_ESTADO_NOME[estadoNome];
    if (!uf || typeof precoMedio !== "number") return;
    rows.push({ uf, municipio: "", produto: produtoNome as AnpProduto, precoMedioCents: Math.round(precoMedio * 100) });
  });

  // Capital de estado NAO aparece na aba MUNICIPIOS — a ANP publica capital
  // numa aba separada, CAPITAIS (confirmado real, 2026-09-05: "SAO PAULO"
  // dentro de MUNICIPIOS da zero resultado, mas esta em CAPITAIS).
  //
  // Colunas NAO tem o mesmo deslocamento da aba ESTADOS: ESTADOS tem uma
  // coluna "REGIAO" antes de "ESTADOS" que MUNICIPIOS/CAPITAIS nao tem, mas
  // ganham uma coluna "MUNICIPIO" que ESTADOS nao tem — as duas diferencas
  // se cancelam e PRODUTO/PRECO MEDIO acabam no MESMO numero de coluna nas
  // 2 abas (confirmado lendo os cabecalhos reais das 3 abas, coluna a
  // coluna — nao adivinhado por contagem visual do array impresso, que
  // enganou uma vez aqui por causa do null de indice 0 do ExcelJS).
  // MUNICIPIOS/CAPITAIS: col3=ESTADO, col4=MUNICIPIO, col5=PRODUTO,
  // col8=PRECO MEDIO REVENDA.
  for (const sheetName of ["MUNICIPIOS", "CAPITAIS"]) {
    const sheet = workbook.getWorksheet(sheetName);
    sheet?.eachRow((row, rowNumber) => {
      if (rowNumber <= 10) return;
      const estadoNome = normalizeAnpText(row.getCell(3).value);
      const municipioNome = normalizeAnpText(row.getCell(4).value);
      const produtoNome = normalizeAnpText(row.getCell(5).value);
      const precoMedio = row.getCell(8).value;
      const uf = UF_BY_ESTADO_NOME[estadoNome];
      if (!uf || !municipioNome || typeof precoMedio !== "number") return;
      rows.push({ uf, municipio: municipioNome, produto: produtoNome as AnpProduto, precoMedioCents: Math.round(precoMedio * 100) });
    });
  }
  return rows;
}
