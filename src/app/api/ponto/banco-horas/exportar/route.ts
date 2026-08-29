import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { BANCO_HORAS_WINDOW_MONTHS, buildBancoHorasReport } from "@/lib/bancoHoras";
import { buildBancoHorasExportTable } from "@/lib/bancoHorasExport";
import { buildExportCsv, buildExportPdf, buildExportXlsx } from "@/lib/pontoMensalExport";

export async function GET(request: NextRequest) {
  const session = await requireSession();
  const { searchParams } = new URL(request.url);
  const formato = searchParams.get("formato") ?? "xlsx";
  const detalhe = searchParams.get("detalhe") === "1";

  const report = await buildBancoHorasReport(session.companyId);
  // Mesmo ranking padrao da tela: maior saldo primeiro.
  const sorted = [...report].sort((a, b) => b.balance.balanceMinutes - a.balance.balanceMinutes);
  const { headers, rows } = buildBancoHorasExportTable(sorted, detalhe);
  const title = `Banco de horas — últimos ${BANCO_HORAS_WINDOW_MONTHS} meses`;
  const filenameBase = `banco-de-horas${detalhe ? "-detalhado" : ""}`;

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

  const buffer = await buildExportXlsx(headers, rows, "Banco de horas");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=${filenameBase}.xlsx`,
    },
  });
}
