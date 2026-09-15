"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchAllEmployees } from "@/lib/tiquetaque/client";
import { signTiqueTaquePlanItem, verifyTiqueTaquePlanItem } from "@/lib/tiquetaque/planToken";
import { importTimesheetCore, MES_REGEX } from "@/lib/tiquetaque/timesheetCore";
import type { TiqueTaquePlanItem, TiqueTaquePlanResult } from "./actions";
import { exigirIntegracoesDaEmpresa } from "@/lib/integracoesEmpresa";

// Mesmo par fase 1 / fase 2 do import de ponto (ver prepareTiqueTaqueImport):
// o cliente orquestra 1 chamada por motorista com pausa, e o token amarra o
// employeeId ao driverId+empresa pra fase 2 nao confiar cegamente no que
// volta do navegador.
export async function prepareTimesheetImport(mes: string): Promise<TiqueTaquePlanResult> {
  const session = await requireRole("ADMIN", "GESTOR");
  await exigirIntegracoesDaEmpresa(session.companyId);
  if (!MES_REGEX.test(mes)) return { error: "Mês inválido (use yyyy-MM)." };

  let employees;
  try {
    employees = await fetchAllEmployees();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao buscar funcionários do TiqueTaque." };
  }
  const employeeByCpf = new Map(employees.map((e) => [e.cpf.replace(/\D/g, ""), e]));

  const drivers = await prisma.driver.findMany({
    where: { companyId: session.companyId, active: true },
    select: { id: true, name: true, cpf: true },
  });
  const plan: TiqueTaquePlanItem[] = drivers.map((driver) => {
    const employeeId = employeeByCpf.get(driver.cpf.replace(/\D/g, ""))?.id ?? null;
    return {
      driverId: driver.id,
      driverName: driver.name,
      employeeId,
      token: employeeId ? signTiqueTaquePlanItem(session.companyId, driver.id, employeeId) : null,
    };
  });
  return { plan };
}

export async function importTimesheetForDriver(
  driverId: string,
  employeeId: string,
  token: string,
  mes: string
): Promise<{ errors: { message: string }[] }> {
  const session = await requireRole("ADMIN", "GESTOR");
  await exigirIntegracoesDaEmpresa(session.companyId);
  if (!MES_REGEX.test(mes)) return { errors: [{ message: "Mês inválido." }] };
  const driver = await prisma.driver.findUnique({ where: { id: driverId, companyId: session.companyId }, select: { id: true } });
  if (!driver) return { errors: [{ message: "Motorista não encontrado." }] };
  if (!verifyTiqueTaquePlanItem(session.companyId, driverId, employeeId, token)) {
    return { errors: [{ message: "Vínculo com o TiqueTaque inválido — refaça a sincronização." }] };
  }
  try {
    await importTimesheetCore(session.companyId, driverId, employeeId, mes);
  } catch (e) {
    return { errors: [{ message: e instanceof Error ? e.message : "Falha ao buscar o espelho." }] };
  }
  revalidatePath("/custos");
  return { errors: [] };
}
