import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DriverBancoHorasBalance } from "@/lib/bancoHoras";
import { formatHoursMinutes } from "@/lib/time";
import type { ExportRow } from "@/lib/pontoMensalExport";

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return format(new Date(year, month - 1, 1), "MMM/yyyy", { locale: ptBR });
}

// Resumo: uma linha por motorista com os totais da janela (mesmo que a tela).
// Detalhado: uma linha por mes de cada motorista, com o saldo acumulado ate
// aquele mes — mesma granularidade do drill-down "ver por mes" da UI.
export function buildBancoHorasExportTable(
  rows: { driverName: string; balance: DriverBancoHorasBalance }[],
  detalhe: boolean
): { headers: string[]; rows: ExportRow[] } {
  if (!detalhe) {
    return {
      headers: ["Motorista", "Crédito (hora extra)", "Débito (folgas)", "Saldo", "Alerta"],
      rows: rows.map(({ driverName, balance }) => [
        driverName,
        formatHoursMinutes(balance.creditMinutes),
        formatHoursMinutes(balance.debitMinutes),
        formatHoursMinutes(Math.max(0, balance.balanceMinutes)),
        balance.atRisk ? "Perto do limite" : "",
      ]),
    };
  }

  const headers = ["Motorista", "Mês", "Crédito (hora extra)", "Débito (folgas)", "Saldo acumulado"];
  const outRows: ExportRow[] = [];
  for (const { driverName, balance } of rows) {
    for (const m of balance.monthly) {
      outRows.push([
        driverName,
        monthLabel(m.monthKey),
        formatHoursMinutes(m.creditMinutes),
        formatHoursMinutes(m.debitMinutes),
        formatHoursMinutes(Math.max(0, m.balanceMinutes)),
      ]);
    }
    outRows.push([
      driverName,
      "Total do período",
      formatHoursMinutes(balance.creditMinutes),
      formatHoursMinutes(balance.debitMinutes),
      formatHoursMinutes(Math.max(0, balance.balanceMinutes)),
    ]);
  }
  return { headers, rows: outRows };
}
