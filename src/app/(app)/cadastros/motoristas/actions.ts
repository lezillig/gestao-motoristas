"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";

const schema = z.object({
  name: z.string().min(2, "Informe o nome do motorista"),
  cpf: z.string().min(11, "CPF inválido"),
  cnh: z.string().min(5, "Informe o número da CNH"),
  cnhCategory: z.string().min(1, "Informe a categoria"),
  cnhExpiration: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .transform(parseLocalDate),
  phone: z.string().optional(),
  sindicatoId: z.string().optional(),
});

function parseForm(formData: FormData) {
  return schema.parse({
    name: formData.get("name"),
    cpf: formData.get("cpf"),
    cnh: formData.get("cnh"),
    cnhCategory: formData.get("cnhCategory"),
    cnhExpiration: formData.get("cnhExpiration"),
    phone: formData.get("phone") || undefined,
    sindicatoId: formData.get("sindicatoId") || undefined,
  });
}

export async function createDriver(formData: FormData) {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);

  await prisma.driver.create({
    data: { ...parsed, companyId: session.companyId },
  });

  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
  redirect("/cadastros/motoristas");
}

export async function updateDriver(id: string, formData: FormData) {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);

  await prisma.driver.update({
    where: { id, companyId: session.companyId },
    data: parsed,
  });

  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
  redirect("/cadastros/motoristas");
}

export async function toggleDriverActive(id: string, active: boolean) {
  const session = await requireRole("ADMIN", "GESTOR");
  await prisma.driver.update({
    where: { id, companyId: session.companyId },
    data: { active },
  });
  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
}
