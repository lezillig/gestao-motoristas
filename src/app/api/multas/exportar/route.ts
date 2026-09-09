import { NextRequest } from "next/server";
import { format } from "date-fns";
import { requireRole } from "@/lib/auth";
import { toArray } from "@/lib/searchParams";
import { MULTA_SORT_FIELDS, fetchMultasList, type MultaSortField, type MultasFilters } from "@/lib/multasList";
import { buildExportCsv, buildExportPdf, buildExportXlsx, type ExportRow } from "@/lib/pontoMensalExport";

function formatBRL(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const INDICACAO_STATUS_LABEL: Record<string, string> = {
  PENDENTE_MANUAL: "Pendente — selecione o motorista",
  SUGERIDA: "Sugerido",
  ENVIADA: "Enviado à LW",
  VALIDADA: "Validado",
  REJEITADA: "Rejeitado",
};

// Mesmos filtros/ordenacao da tela (ver MultasExportBar.tsx) — o arquivo
// exportado reflete exatamente a lista filtrada que o usuario via.
export async function GET(request: NextRequest) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { searchParams } = new URL(request.url);

  const filters: MultasFilters = {
    situacaoLw: toArray(searchParams.getAll("situacaoLw")),
    indicacaoStatus: toArray(searchParams.getAll("indicacaoStatus")),
    vehicleId: toArray(searchParams.getAll("vehicleId")),
    driverId: toArray(searchParams.getAll("driverId")),
  };
  const sortParam = searchParams.get("sort") ?? "";
  const sortField: MultaSortField = (MULTA_SORT_FIELDS as readonly string[]).includes(sortParam)
    ? (sortParam as MultaSortField)
    : "dataInfracao";
  const sortDir = searchParams.get("dir") === "asc" ? "asc" : "desc";
  const formato = searchParams.get("formato") ?? "xlsx";

  const multas = await fetchMultasList(session.companyId, filters, sortField, sortDir);

  const headers = ["Placa", "Data", "Hora", "AIT", "Situação", "Valor", "Prazo indicação", "Status indicação", "Condutor"];
  const rows: ExportRow[] = multas.map((m) => [
    m.vehicle?.plate ?? m.placaConsultada,
    m.dataInfracao ? format(m.dataInfracao, "dd/MM/yyyy") : "",
    m.horaInfracao ?? "",
    m.ait ?? "",
    m.situacaoLw ?? "",
    formatBRL(m.valorCents),
    m.dataLimiteIndicacao ? format(m.dataLimiteIndicacao, "dd/MM/yyyy") : "",
    m.indicacao ? (INDICACAO_STATUS_LABEL[m.indicacao.status] ?? m.indicacao.status) : "",
    m.indicacao?.driver?.name ?? "",
  ]);

  const filenameBase = "multas";

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
    const buffer = await buildExportPdf(headers, rows, "Multas");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${filenameBase}.pdf`,
      },
    });
  }

  const buffer = await buildExportXlsx(headers, rows, "Multas");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=${filenameBase}.xlsx`,
    },
  });
}
