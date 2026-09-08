import { NextRequest } from "next/server";
import { format } from "date-fns";
import { requireRole } from "@/lib/auth";
import { toArray } from "@/lib/searchParams";
import {
  MOTORISTA_SORT_FIELDS,
  fetchMotoristasList,
  type MotoristaSortField,
  type MotoristasFilters,
} from "@/lib/motoristasList";
import { cnhAlertLevel, daysUntil } from "@/lib/driverAlerts";
import { buildExportCsv, buildExportPdf, buildExportXlsx, type ExportRow } from "@/lib/pontoMensalExport";

function cnhCellText(d: { cnhCategory: string | null; cnhExpiration: Date | null; funcao: string | null; departamento: string | null }): string {
  const level = cnhAlertLevel(d.cnhExpiration, d.funcao, d.departamento);
  if (level === "nao_aplicavel") return "";
  if (level === "pendente") return "CNH pendente";
  const dias = d.cnhExpiration ? daysUntil(d.cnhExpiration) : null;
  const base = `${d.cnhCategory ?? ""} · ${format(d.cnhExpiration!, "dd/MM/yyyy")}`;
  if (level === "vencida") return `${base} (vencida há ${Math.abs(dias!)}d)`;
  if (level === "vence_em_breve") return `${base} (vence em ${dias}d)`;
  return base;
}

// Mesmos filtros/ordenacao da tela (ver MotoristasExportBar.tsx) - o
// arquivo exportado reflete exatamente a lista filtrada que o usuario via.
export async function GET(request: NextRequest) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { searchParams } = new URL(request.url);

  const filters: MotoristasFilters = {
    q: searchParams.get("q") ?? undefined,
    sindicatoId: toArray(searchParams.getAll("sindicatoId")),
    status: searchParams.get("status") ?? undefined,
    empregador: toArray(searchParams.getAll("empregador")),
    departamento: toArray(searchParams.getAll("departamento")),
    cargo: toArray(searchParams.getAll("cargo")),
    escala: searchParams.get("escala") ?? undefined,
    cnhStatus: toArray(searchParams.getAll("cnhStatus")),
  };
  const sortParam = searchParams.get("sort") ?? "";
  const sortField: MotoristaSortField = (MOTORISTA_SORT_FIELDS as readonly string[]).includes(sortParam)
    ? (sortParam as MotoristaSortField)
    : "name";
  const sortDir = searchParams.get("dir") === "desc" ? "desc" : "asc";
  const formato = searchParams.get("formato") ?? "xlsx";

  const drivers = await fetchMotoristasList(session.companyId, filters, sortField, sortDir);

  const headers = ["Unidade de alocação", "Cargo", "Nome", "Sindicato", "CPF", "CNH", "Status"];
  const rows: ExportRow[] = drivers.map((d) => [
    d.departamento ?? "",
    d.funcao ?? "",
    d.name,
    d.sindicato?.nome ?? "",
    d.cpf,
    cnhCellText(d),
    d.active ? "Ativo" : "Inativo",
  ]);

  const title = "Motoristas";
  const filenameBase = "motoristas";

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

  const buffer = await buildExportXlsx(headers, rows, "Motoristas");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=${filenameBase}.xlsx`,
    },
  });
}
