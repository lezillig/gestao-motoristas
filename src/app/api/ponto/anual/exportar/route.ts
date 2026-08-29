import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { buildAnnualReport } from "@/lib/pontoAnual";
import { buildAnnualExportTable } from "@/lib/pontoAnualExport";
import { buildExportCsv, buildExportPdf, buildExportXlsx } from "@/lib/pontoMensalExport";

export async function GET(request: NextRequest) {
  const session = await requireSession();
  const { searchParams } = new URL(request.url);
  const anoParam = searchParams.get("ano") ?? "";
  const formato = searchParams.get("formato") ?? "xlsx";
  const visao = searchParams.get("visao") === "extras" ? "extras" : "totais";
  const year = /^\d{4}$/.test(anoParam) ? parseInt(anoParam, 10) : new Date().getFullYear();

  const report = await buildAnnualReport(session.companyId, year);
  // Mesmo ranking fixo do relatorio na tela: mais hora extra no ano primeiro,
  // independente da visao exportada — ver comentario em ponto/anual/page.tsx.
  const sorted = [...report].sort((a, b) => b.totalOvertimeMinutes - a.totalOvertimeMinutes);
  const { headers, rows } = buildAnnualExportTable(sorted, visao);
  const title = `Relatório anual de ${visao === "extras" ? "horas extras" : "horas totais"} — ${year}`;
  const filenameBase = `relatorio-anual-${visao}-${year}`;

  if (formato === "csv") {
    const csv = buildExportCsv(headers, rows);
    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=${filenameBase}.csv`,
      },
    });
  }

  if (formato === "pdf") {
    const buffer = await buildExportPdf(headers, rows, title);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${filenameBase}.pdf`,
      },
    });
  }

  const buffer = await buildExportXlsx(headers, rows, "Relatório anual");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=${filenameBase}.xlsx`,
    },
  });
}
