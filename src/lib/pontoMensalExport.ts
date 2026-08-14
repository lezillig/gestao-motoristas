import ExcelJS from "exceljs";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DriverMonthlyReport } from "@/lib/pontoMensal";
import { formatHoursMinutes } from "@/lib/time";
import { parsePunches } from "@/lib/pontoCompliance";

export type ExportRow = string[];

// Resumo: uma linha por motorista (nome + total do mes). Detalhado: uma
// linha por dia com registro, no mesmo formato do relatorio nativo do
// TiqueTaque (colunas Entrada/Saida por par, ate o maior numero de pares
// visto no mes), mais uma linha de total ao final de cada motorista — mesma
// tabela serve pros tres formatos (xlsx/csv/pdf).
export function buildExportTable(
  report: DriverMonthlyReport[],
  detalhe: boolean
): { headers: string[]; rows: ExportRow[] } {
  if (!detalhe) {
    return {
      headers: ["Motorista", "Total do mês"],
      rows: report.map((r) => [r.driverName, formatHoursMinutes(r.totalMinutes)]),
    };
  }

  let maxPairs = 1;
  for (const r of report) {
    for (const week of r.weeks) {
      for (const day of week.days) {
        if (!day) continue;
        for (const entry of day.entries) {
          const pairs = entry.punches
            ? parsePunches(entry.punches)
            : [{ entrada: entry.clockIn, saida: entry.clockOut }];
          maxPairs = Math.max(maxPairs, pairs.length);
        }
      }
    }
  }

  const headers = ["Motorista", "Data", "Dia da semana"];
  for (let i = 1; i <= maxPairs; i++) headers.push(`Entrada ${i}`, `Saída ${i}`);
  headers.push("Hora extra (50%)", "Total");

  const rows: ExportRow[] = [];
  for (const r of report) {
    for (const week of r.weeks) {
      for (const day of week.days) {
        if (!day || !day.hasEntry) continue;
        for (const entry of day.entries) {
          const pairs = entry.punches
            ? parsePunches(entry.punches)
            : [{ entrada: entry.clockIn, saida: entry.clockOut }];
          const row: string[] = [r.driverName, format(day.date, "dd/MM/yyyy"), format(day.date, "EEEE", { locale: ptBR })];
          for (let i = 0; i < maxPairs; i++) {
            row.push(pairs[i]?.entrada ?? "", pairs[i]?.saida ?? "");
          }
          row.push(
            day.overtimeMinutes > 0 ? formatHoursMinutes(day.overtimeMinutes) : "",
            day.open ? "em aberto" : formatHoursMinutes(day.minutes)
          );
          rows.push(row);
        }
      }
    }
    rows.push([r.driverName, "", "Total do mês", ...Array(maxPairs * 2).fill(""), "", formatHoursMinutes(r.totalMinutes)]);
  }
  return { headers, rows };
}

export async function buildExportXlsx(headers: string[], rows: ExportRow[], sheetName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  rows.forEach((r) => sheet.addRow(r));
  sheet.columns = headers.map(() => ({ width: 24 }));
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function buildExportCsv(headers: string[], rows: ExportRow[]): string {
  const escape = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers, ...rows].map((r) => r.map(escape).join(";")).join("\n");
}

function distributeColumns(count: number, totalWidth: number): number[] {
  const width = totalWidth / count;
  return Array.from({ length: count }, () => width);
}

export async function buildExportPdf(headers: string[], rows: ExportRow[], title: string): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 841.89; // A4 paisagem
  const pageHeight = 595.28;
  const margin = 36;
  const colWidths = distributeColumns(headers.length, pageWidth - margin * 2);

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawHeaderRow = () => {
    let x = margin;
    headers.forEach((h, i) => {
      page.drawText(h, { x, y, size: 9, font: boldFont, color: rgb(0.2, 0.2, 0.25) });
      x += colWidths[i];
    });
    y -= 6;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= 12;
  };

  page.drawText(title, { x: margin, y, size: 14, font: boldFont, color: rgb(0.1, 0.1, 0.15) });
  y -= 24;
  drawHeaderRow();

  for (const row of rows) {
    if (y < margin + 20) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      drawHeaderRow();
    }
    let x = margin;
    row.forEach((cell, i) => {
      page.drawText(cell.length > 45 ? `${cell.slice(0, 45)}…` : cell, {
        x,
        y,
        size: 8,
        font,
        color: rgb(0.15, 0.15, 0.2),
      });
      x += colWidths[i];
    });
    y -= 13;
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
