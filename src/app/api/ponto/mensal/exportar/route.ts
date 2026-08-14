import { NextRequest } from "next/server";
import { startOfMonth } from "date-fns";
import { requireSession } from "@/lib/auth";
import { buildMonthlyReport } from "@/lib/pontoMensal";
import { buildExportCsv, buildExportPdf, buildExportTable, buildExportXlsx } from "@/lib/pontoMensalExport";

export async function GET(request: NextRequest) {
  const session = await requireSession();
  const { searchParams } = new URL(request.url);
  const mes = searchParams.get("mes") ?? "";
  const formato = searchParams.get("formato") ?? "xlsx";
  const detalhe = searchParams.get("detalhe") === "1";

  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return new Response("Mês inválido", { status: 400 });
  }

  const monthStart = startOfMonth(new Date(`${mes}-01T00:00:00`));
  const report = await buildMonthlyReport(session.companyId, monthStart);
  const { headers, rows } = buildExportTable(report, detalhe);
  const title = `Relatório mensal de ponto — ${mes}`;
  const filenameBase = `relatorio-ponto-${mes}${detalhe ? "-detalhado" : ""}`;

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

  const buffer = await buildExportXlsx(headers, rows, "Relatório mensal");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=${filenameBase}.xlsx`,
    },
  });
}
