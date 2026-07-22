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
export type TiqueTaqueImportResult = { created: number; errors: TiqueTaqueImportRowError[] };
export type TiqueTaqueImportState = { error?: string; result?: TiqueTaqueImportResult };

const tiqueTaqueRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inicial inválida"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data final inválida"),
});

// Busca funcionarios do TiqueTaque (casados por CPF com os motoristas ja
// cadastrados) e as batidas do periodo, criando um TimeClockEntry por dia
// pareado — ver src/lib/tiquetaque/pairing.ts para a logica de pareamento.
// Nunca sobrescreve um registro ja existente (de qualquer origem): motorista
// sem CPF correspondente ou dia ja lancado vira erro reportado, nao um
// overwrite silencioso.
export async function importFromTiqueTaque(
  _prevState: TiqueTaqueImportState,
  formData: FormData
): Promise<TiqueTaqueImportState> {
  const session = await requireRole("ADMIN", "GESTOR");

  const parsed = tiqueTaqueRangeSchema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });
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
  });

  const rangeStart = parseLocalDate(parsed.data.startDate);
  const rangeEnd = parseLocalDate(parsed.data.endDate);
  const existingEntries = await prisma.timeClockEntry.findMany({
    where: { companyId: session.companyId, date: { gte: rangeStart, lte: rangeEnd } },
    select: { driverId: true, date: true },
  });
  const existingKeys = new Set(existingEntries.map((e) => `${e.driverId}_${format(e.date, "yyyy-MM-dd")}`));

  const errors: TiqueTaqueImportRowError[] = [];
  let created = 0;

  for (const driver of drivers) {
    const employee = employeeByCpf.get(driver.cpf.replace(/\D/g, ""));
    if (!employee) {
      errors.push({ driverName: driver.name, message: "Nenhum funcionário com este CPF encontrado no TiqueTaque." });
      continue;
    }

    let days;
    try {
      days = await fetchEmployeeDays(employee.id, parsed.data.startDate, parsed.data.endDate);
    } catch (e) {
      errors.push({ driverName: driver.name, message: e instanceof Error ? e.message : "Falha ao buscar batidas do TiqueTaque." });
      continue;
    }

    for (const day of days) {
      const key = `${driver.id}_${day.date}`;
      if (existingKeys.has(key)) {
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
      existingKeys.add(key);
      created++;
    }
  }

  revalidatePath("/ponto");
  revalidatePath("/ponto/analise");
  return { result: { created, errors } };
}
