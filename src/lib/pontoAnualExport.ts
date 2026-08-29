import type { DriverAnnualReport } from "@/lib/pontoAnual";
import { formatHoursMinutes } from "@/lib/time";
import type { ExportRow } from "@/lib/pontoMensalExport";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function buildAnnualExportTable(
  report: DriverAnnualReport[],
  visao: "totais" | "extras"
): { headers: string[]; rows: ExportRow[] } {
  const headers = ["Motorista", ...MESES, "Total do ano"];
  const rows: ExportRow[] = report.map((r) => {
    const monthly = visao === "extras" ? r.monthlyOvertimeMinutes : r.monthlyWorkedMinutes;
    const total = visao === "extras" ? r.totalOvertimeMinutes : r.totalWorkedMinutes;
    return [r.driverName, ...monthly.map((m) => (m > 0 ? formatHoursMinutes(m) : "—")), formatHoursMinutes(total)];
  });
  return { headers, rows };
}
