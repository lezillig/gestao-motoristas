"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";

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
  notes: z.string().optional(),
});

function parseForm(formData: FormData) {
  return schema.safeParse({
    driverId: formData.get("driverId"),
    date: formData.get("date"),
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut") || undefined,
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
