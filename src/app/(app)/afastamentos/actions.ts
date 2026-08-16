"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { fetchAllEmployees, fetchEmployeeLeaves } from "@/lib/tiquetaque/client";
import { signTiqueTaquePlanItem, verifyTiqueTaquePlanItem } from "@/lib/tiquetaque/planToken";

// `token` amarra o employeeId ao driverId+empresa (ver planToken.ts) — a
// fase 2 recebe o employeeId de volta do cliente e PRECISA revalidar esse
// vinculo antes de usá-lo (mesmo padrão do import de ponto).
export type LeaveImportPlanItem = { driverId: string; driverName: string; employeeId: string | null; token: string | null };
export type LeaveImportPlanResult = { error?: string; plan?: LeaveImportPlanItem[] };

// Mesmo padrao de duas fases ja usado pro import de ponto do TiqueTaque
// (src/app/(app)/ponto/actions.ts): monta o plano com UMA chamada, depois o
// cliente faz uma chamada curta por motorista — evita o timeout de funcao
// serverless que uma importacao monolitica levaria com centenas de
// motoristas.
export async function prepareLeaveImport(): Promise<LeaveImportPlanResult> {
  const session = await requireRole("ADMIN", "GESTOR");

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

  const plan: LeaveImportPlanItem[] = drivers.map((driver) => {
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

export type LeaveImportRowError = { driverName: string; message: string };
export type LeaveImportDriverResult = { imported: number; errors: LeaveImportRowError[] };

// Upsert por tiquetaqueId (nao "nunca sobrescreve" como o importador de
// ponto) — de proposito: um afastamento pode ser aprovado, corrigido ou
// detalhado depois de criado no TiqueTaque, e continua sendo o MESMO
// registro (mesmo _id), nao um novo. Nao ha caminho de edicao manual pra
// esse modelo ainda, entao nao existe "dado do usuario" pra proteger aqui.
export async function importLeavesForDriver(
  driverId: string,
  employeeId: string,
  token: string
): Promise<LeaveImportDriverResult> {
  const session = await requireRole("ADMIN", "GESTOR");

  const driver = await prisma.driver.findUnique({ where: { id: driverId, companyId: session.companyId } });
  if (!driver) {
    return { imported: 0, errors: [{ driverName: "—", message: "Motorista não encontrado." }] };
  }

  if (!verifyTiqueTaquePlanItem(session.companyId, driverId, employeeId, token)) {
    return { imported: 0, errors: [{ driverName: driver.name, message: "Vínculo com o TiqueTaque inválido — refaça a importação." }] };
  }

  let leaves;
  try {
    leaves = await fetchEmployeeLeaves(employeeId);
  } catch (e) {
    return {
      imported: 0,
      errors: [
        {
          driverName: driver.name,
          message: e instanceof Error ? e.message : "Falha ao buscar afastamentos do TiqueTaque.",
        },
      ],
    };
  }

  let imported = 0;
  for (const leave of leaves) {
    await prisma.driverLeave.upsert({
      where: { tiquetaqueId: leave.id },
      create: {
        companyId: session.companyId,
        driverId: driver.id,
        tiquetaqueId: leave.id,
        leaveType: leave.leaveType,
        startDate: parseLocalDate(leave.startDate),
        endDate: parseLocalDate(leave.endDate),
        details: leave.details,
        paidLeave: leave.paidLeave,
      },
      update: {
        leaveType: leave.leaveType,
        startDate: parseLocalDate(leave.startDate),
        endDate: parseLocalDate(leave.endDate),
        details: leave.details,
        paidLeave: leave.paidLeave,
      },
    });
    imported++;
  }

  revalidatePath("/afastamentos");
  return { imported, errors: [] };
}
