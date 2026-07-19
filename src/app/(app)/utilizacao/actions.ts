"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { combineLocalDateTime } from "@/lib/date";

export type UsageFormState = { error?: string };

const createSchema = z.object({
  driverId: z.string().min(1, "Selecione o motorista"),
  vehicleId: z.string().min(1, "Selecione o veículo"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Horário inválido"),
  kmInicial: z.coerce.number().int().min(0, "Km inicial inválido"),
  notes: z.string().optional(),
});

export async function createUsageLog(
  _prevState: UsageFormState,
  formData: FormData
): Promise<UsageFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = createSchema.safeParse({
    driverId: formData.get("driverId"),
    vehicleId: formData.get("vehicleId"),
    date: formData.get("date"),
    time: formData.get("time"),
    kmInicial: formData.get("kmInicial"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: parsed.data.vehicleId, companyId: session.companyId },
  });
  if (!vehicle) return { error: "Veículo não encontrado." };
  if (parsed.data.kmInicial < vehicle.currentMileage) {
    return {
      error: `Km inicial não pode ser menor que a quilometragem atual do veículo (${vehicle.currentMileage} km).`,
    };
  }

  const checkInAt = combineLocalDateTime(parsed.data.date, parsed.data.time);

  await prisma.vehicleUsageLog.create({
    data: {
      companyId: session.companyId,
      driverId: parsed.data.driverId,
      vehicleId: parsed.data.vehicleId,
      checkInAt,
      kmInicial: parsed.data.kmInicial,
      notes: parsed.data.notes,
    },
  });

  revalidatePath("/utilizacao");
  redirect("/utilizacao");
}

const closeSchema = z.object({
  kmFinal: z.coerce.number().int().min(0, "Km final inválido"),
});

export async function closeUsageLog(id: string, formData: FormData) {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = closeSchema.safeParse({ kmFinal: formData.get("kmFinal") });
  if (!parsed.success) redirect("/utilizacao");

  const log = await prisma.vehicleUsageLog.findUnique({
    where: { id, companyId: session.companyId },
  });
  if (!log) redirect("/utilizacao");
  if (parsed.data.kmFinal < log.kmInicial) redirect("/utilizacao");

  await prisma.$transaction([
    prisma.vehicleUsageLog.update({
      where: { id },
      data: { checkOutAt: new Date(), kmFinal: parsed.data.kmFinal },
    }),
    prisma.vehicle.update({
      where: { id: log.vehicleId },
      data: { currentMileage: parsed.data.kmFinal },
    }),
  ]);

  revalidatePath("/utilizacao");
  revalidatePath("/cadastros/veiculos");
  redirect("/utilizacao");
}

export async function registerMaintenance(vehicleId: string) {
  const session = await requireRole("ADMIN", "GESTOR");
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId, companyId: session.companyId },
  });
  if (!vehicle) redirect("/utilizacao");

  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: { lastMaintenanceMileage: vehicle.currentMileage },
  });

  revalidatePath("/utilizacao");
  revalidatePath("/cadastros/veiculos");
  redirect("/utilizacao");
}
