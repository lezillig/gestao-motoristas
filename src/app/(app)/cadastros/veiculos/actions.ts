"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  plate: z.string().min(6, "Placa inválida").toUpperCase(),
  brand: z.string().min(1, "Informe a marca"),
  model: z.string().min(1, "Informe o modelo"),
  year: z.coerce.number().int().min(1980).max(2100),
  type: z.string().min(1, "Informe o tipo"),
  status: z.enum(["ATIVO", "MANUTENCAO", "INATIVO"]),
});

function parseForm(formData: FormData) {
  return schema.parse({
    plate: formData.get("plate"),
    brand: formData.get("brand"),
    model: formData.get("model"),
    year: formData.get("year"),
    type: formData.get("type"),
    status: formData.get("status"),
  });
}

export async function createVehicle(formData: FormData) {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);

  await prisma.vehicle.create({
    data: { ...parsed, companyId: session.companyId },
  });

  revalidatePath("/cadastros/veiculos");
  redirect("/cadastros/veiculos");
}

export async function updateVehicle(id: string, formData: FormData) {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);

  await prisma.vehicle.update({
    where: { id, companyId: session.companyId },
    data: parsed,
  });

  revalidatePath("/cadastros/veiculos");
  redirect("/cadastros/veiculos");
}
