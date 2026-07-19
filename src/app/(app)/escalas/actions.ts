"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findEscalaConflicts } from "@/lib/escalaConflicts";
import { parseLocalDate } from "@/lib/date";

export type EscalaFormState = { error?: string };

const schema = z
  .object({
    driverId: z.string().min(1, "Selecione o motorista"),
    vehicleId: z.string().min(1, "Selecione o veículo"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
      .transform(parseLocalDate),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Horário inválido"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "Horário inválido"),
    notes: z.string().optional(),
  })
  .refine((data) => data.startTime < data.endTime, {
    message: "O horário final deve ser depois do horário inicial",
    path: ["endTime"],
  });

function parseForm(formData: FormData) {
  return schema.safeParse({
    driverId: formData.get("driverId"),
    vehicleId: formData.get("vehicleId"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    notes: formData.get("notes") || undefined,
  });
}

function conflictMessage(
  conflicts: Awaited<ReturnType<typeof findEscalaConflicts>>
) {
  const parts = conflicts.map((c) =>
    c.type === "motorista"
      ? `motorista já escalado das ${c.startTime} às ${c.endTime} (veículo ${c.vehiclePlate})`
      : `veículo já escalado das ${c.startTime} às ${c.endTime} (motorista ${c.driverName})`
  );
  return `Conflito de horário: ${parts.join("; ")}.`;
}

export async function createEscala(
  _prevState: EscalaFormState,
  formData: FormData
): Promise<EscalaFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const conflicts = await findEscalaConflicts({
    companyId: session.companyId,
    ...parsed.data,
  });
  if (conflicts.length > 0) {
    return { error: conflictMessage(conflicts) };
  }

  await prisma.escala.create({
    data: { ...parsed.data, companyId: session.companyId },
  });

  revalidatePath("/escalas");
  redirect("/escalas");
}

export async function updateEscala(
  id: string,
  _prevState: EscalaFormState,
  formData: FormData
): Promise<EscalaFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const conflicts = await findEscalaConflicts({
    companyId: session.companyId,
    ...parsed.data,
    excludeId: id,
  });
  if (conflicts.length > 0) {
    return { error: conflictMessage(conflicts) };
  }

  await prisma.escala.update({
    where: { id, companyId: session.companyId },
    data: parsed.data,
  });

  revalidatePath("/escalas");
  redirect("/escalas");
}

export async function deleteEscala(id: string) {
  const session = await requireRole("ADMIN", "GESTOR");
  await prisma.escala.delete({ where: { id, companyId: session.companyId } });
  revalidatePath("/escalas");
  redirect("/escalas");
}
