"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { fetchAllEmployees, fetchEmployeeDays } from "@/lib/tiquetaque/client";

export type PontoFormState = { error?: string };

const schema = z.object({
  driverId: z.string().min(1, "Selecione o motorista"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .transform(parseLocalDate),
  clockIn: z.string().regex(/^\d{2}:\d{2}$/, "Horário de entrada inválido"),
  clockOut: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Horário de saída inválido")
    .optional(),
  intervaloInicio: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Horário de início do intervalo inválido")
    .optional(),
  intervaloFim: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Horário de fim do intervalo inválido")
    .optional(),
  notes: z.string().optional(),
});

function parseForm(formData: FormData) {
  return schema.safeParse({
    driverId: formData.get("driverId"),
    date: formData.get("date"),
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut") || undefined,
    intervaloInicio: formData.get("intervaloInicio") || undefined,
    intervaloFim: formData.get("intervaloFim") || undefined,
    notes: formData.get("notes") || undefined,
  });
}

async function assertNoDuplicate(
  companyId: string,
  driverId: string,
  date: Date,
  excludeId?: string
) {
  const existing = await prisma.timeClockEntry.findFirst({
    where: {
      companyId,
      driverId,
      date,
      id: excludeId ? { not: excludeId } : undefined,
    },
  });
  return existing !== null;
}

async function assertDriverOwnership(companyId: string, driverId: string): Promise<boolean> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId, companyId } });
  return driver !== null;
}

export async function createEntry(
  _prevState: PontoFormState,
  formData: FormData
): Promise<PontoFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  if (!(await assertDriverOwnership(session.companyId, parsed.data.driverId))) {
    return { error: "Motorista não encontrado." };
  }

  const duplicate = await assertNoDuplicate(session.companyId, parsed.data.driverId, parsed.data.date);
  if (duplicate) {
    return { error: "Já existe um registro de ponto para este motorista nesta data. Edite o registro existente." };
  }

  await prisma.timeClockEntry.create({
    data: {
      ...parsed.data,
      clockOut: parsed.data.clockOut || null,
      intervaloInicio: parsed.data.intervaloInicio || null,
      intervaloFim: parsed.data.intervaloFim || null,
      companyId: session.companyId,
    },
  });

  revalidatePath("/ponto");
  redirect("/ponto");
}

export async function updateEntry(
  id: string,
  _prevState: PontoFormState,
  formData: FormData
): Promise<PontoFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  if (!(await assertDriverOwnership(session.companyId, parsed.data.driverId))) {
    return { error: "Motorista não encontrado." };
  }

  const duplicate = await assertNoDuplicate(session.companyId, parsed.data.driverId, parsed.data.date, id);
  if (duplicate) {
    return { error: "Já existe um registro de ponto para este motorista nesta data. Edite o registro existente." };
  }

  await prisma.timeClockEntry.update({
    where: { id, companyId: session.companyId },
    data: {
      ...parsed.data,
      clockOut: parsed.data.clockOut || null,
      intervaloInicio: parsed.data.intervaloInicio || null,
      intervaloFim: parsed.data.intervaloFim || null,
    },
  });

  revalidatePath("/ponto");
  redirect("/ponto");
}

export async function deleteEntry(id: string) {
  const session = await requireRole("ADMIN", "GESTOR");
  await prisma.timeClockEntry.delete({ where: { id, companyId: session.companyId } });
  revalidatePath("/ponto");
  redirect("/ponto");
}

export type TiqueTaqueImportRowError = { driverName: string; date?: string; message: string };
export type TiqueTaqueDriverImportResult = { created: number; errors: TiqueTaqueImportRowError[] };
export type TiqueTaquePlanItem = { driverId: string; driverName: string; employeeId: string | null };
export type TiqueTaquePlanResult = { error?: string; plan?: TiqueTaquePlanItem[] };

const tiqueTaqueRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inicial inválida"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data final inválida"),
});

// Fase 1 (rapida): busca a lista de funcionarios do TiqueTaque UMA vez e casa
// por CPF com os motoristas ativos da empresa, devolvendo um plano — nao
// busca batidas ainda. O cliente chama importDriverFromTiqueTaque uma vez por
// item do plano, cada chamada curta o bastante pra nao estourar o timeout de
// funcao serverless que uma importacao monolitica (todos os motoristas numa
// so chamada) acabava batendo em producao com periodos longos.
export async function prepareTiqueTaqueImport(
  startDate: string,
  endDate: string
): Promise<TiqueTaquePlanResult> {
  const session = await requireRole("ADMIN", "GESTOR");

  const parsed = tiqueTaqueRangeSchema.safeParse({ startDate, endDate });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datas inválidas" };
  }
  if (parsed.data.startDate > parsed.data.endDate) {
    return { error: "A data inicial deve ser anterior à data final." };
  }

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

  const plan: TiqueTaquePlanItem[] = drivers.map((driver) => ({
    driverId: driver.id,
    driverName: driver.name,
    employeeId: employeeByCpf.get(driver.cpf.replace(/\D/g, ""))?.id ?? null,
  }));

  return { plan };
}

// Fase 2: uma chamada curta por motorista (busca so as batidas DELE no
// periodo e cria os registros) — nunca sobrescreve um registro ja existente
// de nenhuma origem.
export async function importDriverFromTiqueTaque(
  driverId: string,
  employeeId: string,
  startDate: string,
  endDate: string
): Promise<TiqueTaqueDriverImportResult> {
  const session = await requireRole("ADMIN", "GESTOR");

  const driver = await prisma.driver.findUnique({ where: { id: driverId, companyId: session.companyId } });
  if (!driver) {
    return { created: 0, errors: [{ driverName: "—", message: "Motorista não encontrado." }] };
  }

  let days;
  try {
    days = await fetchEmployeeDays(employeeId, startDate, endDate);
  } catch (e) {
    return {
      created: 0,
      errors: [{ driverName: driver.name, message: e instanceof Error ? e.message : "Falha ao buscar batidas do TiqueTaque." }],
    };
  }

  const existingEntries = await prisma.timeClockEntry.findMany({
    where: {
      companyId: session.companyId,
      driverId,
      date: { gte: parseLocalDate(startDate), lte: parseLocalDate(endDate) },
    },
    select: { date: true },
  });
  const existingDates = new Set(existingEntries.map((e) => format(e.date, "yyyy-MM-dd")));

  const errors: TiqueTaqueImportRowError[] = [];
  let created = 0;

  for (const day of days) {
    if (existingDates.has(day.date)) {
      errors.push({ driverName: driver.name, date: day.date, message: "Já existe registro de ponto nesta data — não sobrescrito." });
      continue;
    }

    await prisma.timeClockEntry.create({
      data: {
        companyId: session.companyId,
        driverId: driver.id,
        date: parseLocalDate(day.date),
        clockIn: day.clockIn,
        clockOut: day.clockOut,
        intervaloInicio: day.intervaloInicio,
        intervaloFim: day.intervaloFim,
        fonte: "TIQUETAQUE",
      },
    });
    existingDates.add(day.date);
    created++;
  }

  revalidatePath("/ponto");
  revalidatePath("/ponto/analise");
  return { created, errors };
}
