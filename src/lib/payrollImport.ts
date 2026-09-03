import * as XLSX from "xlsx";
import { normalizeText, cellToLocalDateString } from "./spreadsheet";
import { normalizeCpf } from "./cpf";

// Le a exportacao "Empregados em Excel" do sistema de folha de pagamento
// (formato .xls legado ou .xlsx, com dezenas de colunas do eSocial). Usa
// SheetJS (nao o ExcelJS usado no resto do app) porque ExcelJS so le
// .xlsx — esse formato de exportacao normalmente vem em .xls legado.
//
// Le a matriz bruta (header:1, uma linha = um array por posicao) em vez do
// modo objeto-por-cabecalho usado em spreadsheet.ts: essa planilha repete o
// cabecalho "Categoria" duas vezes (categoria de contrato na coluna 8 e
// categoria de CNH logo depois da coluna "CNH"), o que quebraria uma leitura
// por nome de coluna. Os campos de CNH sao localizados por POSICAO relativa
// a coluna "CNH" (unica), na ordem fixa observada nos arquivos reais:
// CNH, Categoria, Expedicao CNH, Vencimento.
export type PayrollRow = {
  nome: string;
  cpf: string;
  cnh: string;
  cnhCategory: string;
  cnhExpiration: string | null; // AAAA-MM-DD
  admissao: string | null; // AAAA-MM-DD
  telefone: string;
  funcao: string;
  departamento: string;
  sindicato: string;
  ativo: boolean;
};

const REQUIRED_HEADERS = ["Nome", "CPF", "CNH", "Admissão", "Telefone"];

export function parsePayrollWorkbook(buffer: Buffer): PayrollRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new Error(
      "Não foi possível ler o arquivo. Se for .xls, abra no Excel, salve como .xlsx e tente de novo."
    );
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    // Alguns exports .xls legados desse sistema trazem um ponteiro interno
    // de planilha inconsistente (nome da aba maior que o limite de 31
    // caracteres do Excel, aparentemente nao regravado pelo exportador) —
    // o Excel de verdade abre normal, mas um parser JS nao acha a planilha.
    // Unico jeito de recuperar sem depender do Excel: reabrir e salvar como
    // .xlsx antes de enviar.
    throw new Error(
      "Não foi possível ler as linhas da planilha (o arquivo .xls parece ter um índice interno inconsistente). Abra o arquivo no Excel, use \"Salvar como\" → .xlsx e envie o .xlsx."
    );
  }

  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  if (matrix.length < 2) {
    throw new Error("A planilha não tem linhas de dados.");
  }

  const header = matrix[0].map((h) => String(h ?? "").trim());
  for (const required of REQUIRED_HEADERS) {
    if (!header.includes(required)) {
      throw new Error(
        `Coluna "${required}" não encontrada — este arquivo não parece ser a exportação "Empregados em Excel" da folha de pagamento.`
      );
    }
  }

  const cnhIdx = header.indexOf("CNH");
  if (header[cnhIdx + 1] !== "Categoria" || header[cnhIdx + 3] !== "Vencimento") {
    throw new Error("Layout das colunas de CNH não reconhecido nesta planilha (formato pode ter mudado).");
  }

  const col = {
    nome: header.indexOf("Nome"),
    cpf: header.indexOf("CPF"),
    cnh: cnhIdx,
    cnhCategory: cnhIdx + 1,
    cnhVencimento: cnhIdx + 3,
    admissao: header.indexOf("Admissão"),
    telefone: header.indexOf("Telefone"),
    celular: header.indexOf("Celular"),
    funcao: header.indexOf("Descrição cargo"),
    departamento: header.indexOf("Descrição Ccusto"),
    sindicato: header.indexOf("Sindicato"),
    dataDemissao: header.indexOf("Data Demissão"),
  };

  const rows: PayrollRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i];
    const nome = normalizeText(r[col.nome]);
    const cpfRaw = normalizeText(r[col.cpf]);
    if (!nome && !cpfRaw) continue; // linha em branco
    // Planilha pode trazer o CPF como celula numerica (perde zero(s) a
    // esquerda) — normaliza pra 11 digitos ANTES de qualquer validacao.
    const cpf = normalizeCpf(cpfRaw);

    const telefone = normalizeText(r[col.telefone]) || normalizeText(r[col.celular]);
    rows.push({
      nome,
      cpf,
      cnh: normalizeText(r[col.cnh]),
      cnhCategory: normalizeText(r[col.cnhCategory]),
      cnhExpiration: cellToLocalDateString(r[col.cnhVencimento]),
      admissao: cellToLocalDateString(r[col.admissao]),
      telefone,
      funcao: normalizeText(r[col.funcao]),
      departamento: normalizeText(r[col.departamento]),
      sindicato: normalizeText(r[col.sindicato]),
      ativo: !normalizeText(r[col.dataDemissao]),
    });
  }
  return rows;
}
