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

function anpFileUrl(start: Date, end: Date): string {
  const ano = start.getFullYear();
  const s = format(start, "yyyy-MM-dd");
  const e = format(end, "yyyy-MM-dd");
  return `https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/arquivos-lpc/${ano}/resumo_semanal_lpc_${s}_${e}.xlsx`;
}

export type AnpPriceRow = { uf: string; produto: AnpProduto; precoMedioCents: number };

// Busca e parseia o arquivo publico da ANP pra uma semana especifica.
// Devolve null (em vez de lancar erro) quando o arquivo ainda nao foi
// publicado (semana futura, atraso por feriado, etc.) — a sincronizacao
// que chama isto e best-effort, uma semana faltando nao trava as outras.
export async function fetchAnpWeek(start: Date, end: Date): Promise<AnpPriceRow[] | null> {
  const url = anpFileUrl(start, end);
  const res = await fetch(url);
  if (!res.ok) return null;

  const buffer = Buffer.from(await res.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet("ESTADOS");
  if (!sheet) return null;

  const rows: AnpPriceRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 10) return; // linhas 1-10 sao cabecalho/metadados
    const estadoNome = String(row.getCell(4).value ?? "").trim().toUpperCase();
    const produtoNome = String(row.getCell(5).value ?? "").trim().toUpperCase();
    const precoMedio = row.getCell(8).value;
    const uf = UF_BY_ESTADO_NOME[estadoNome];
    if (!uf || typeof precoMedio !== "number") return;
    rows.push({ uf, produto: produtoNome as AnpProduto, precoMedioCents: Math.round(precoMedio * 100) });
  });
  return rows;
}
