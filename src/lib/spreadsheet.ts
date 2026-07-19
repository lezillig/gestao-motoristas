import ExcelJS from "exceljs";

// Le a primeira planilha de um arquivo .xlsx e devolve uma linha por objeto,
// usando o cabecalho (primeira linha) como chave — mesma forma que
// FormData.get, para reaproveitar os schemas Zod ja existentes por linha.
export async function readWorkbookRows(buffer: Buffer): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) obj[header] = cell.value;
    });
    rows.push(obj);
  });
  return rows;
}

export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in (value as Record<string, unknown>)) {
    // Celula com rich text (ExcelJS retorna { richText: [...] } ou { text, hyperlink }).
    return String((value as { text?: unknown }).text ?? "").trim();
  }
  return String(value).trim();
}

// Aceita Date (celula formatada como data no Excel), string "AAAA-MM-DD" ou
// "DD/MM/AAAA". Datas do ExcelJS vem como Date em UTC-meia-noite; usamos os
// componentes UTC para nao sofrer o mesmo bug de fuso descrito em date.ts.
export function cellToLocalDateString(value: unknown): string | null {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const text = normalizeText(value);
  if (!text) return null;

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;

  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;

  return null;
}

export async function buildTemplateXlsx(options: {
  sheetName: string;
  headers: string[];
  example: (string | number)[];
  columnWidths?: number[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(options.sheetName);
  sheet.addRow(options.headers);
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(options.example);
  sheet.columns = options.headers.map((_, i) => ({ width: options.columnWidths?.[i] ?? 22 }));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
