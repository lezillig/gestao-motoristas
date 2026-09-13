import { endOfMonth, format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { fetchEmployeeTimesheet } from "./client";

export const MES_REGEX = /^\d{4}-\d{2}$/;

export function mesRange(mes: string): { start: string; end: string } {
  const start = parseLocalDate(`${mes}-01`);
  return { start: format(start, "yyyy-MM-dd"), end: format(endOfMonth(start), "yyyy-MM-dd") };
}

// Uma chamada curta por motorista/mes (mesmo desenho de importDriverDaysCore):
// busca o espelho apurado do mes inteiro e substitui a linha local. Sempre
// substitui — diferente do ponto (append + correcao auditada), o espelho e
// um retrato consolidado que o TiqueTaque recalcula quando o mes muda
// (ajuste, abono, feriado lancado depois), entao a versao mais nova vence.
export async function importTimesheetCore(
  companyId: string,
  driverId: string,
  employeeId: string,
  mes: string,
  deadline?: number
): Promise<void> {
  const { start, end } = mesRange(mes);
  const t = await fetchEmployeeTimesheet(employeeId, start, end, deadline);
  const data = {
    horasNormais: t.horasNormais,
    extra50: t.extra50,
    extra100: t.extra100,
    adicionalNoturno: t.adicionalNoturno,
    horaNoturnaReduzida: t.horaNoturnaReduzida,
    dsr: t.dsr,
    folga: t.folga,
    atraso: t.atraso,
    totalHoras: t.total,
    dias: t.dias as object,
    syncedAt: new Date(),
  };
  await prisma.timesheetMensal.upsert({
    where: { driverId_mes: { driverId, mes } },
    create: { companyId, driverId, mes, ...data },
    update: data,
  });
}
