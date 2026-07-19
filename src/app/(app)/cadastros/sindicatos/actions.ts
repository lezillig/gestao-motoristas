"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  nome: z.string().min(2, "Informe o nome do sindicato"),
  cnpj: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
});

export async function createSindicato(formData: FormData) {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = schema.parse({
    nome: formData.get("nome"),
    cnpj: formData.get("cnpj") || undefined,
    cidade: formData.get("cidade") || undefined,
    estado: formData.get("estado") || undefined,
  });

  await prisma.sindicato.create({
    data: { ...parsed, companyId: session.companyId },
  });

  revalidatePath("/cadastros/sindicatos");
  redirect("/cadastros/sindicatos");
}

export async function updateSindicato(id: string, formData: FormData) {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = schema.parse({
    nome: formData.get("nome"),
    cnpj: formData.get("cnpj") || undefined,
    cidade: formData.get("cidade") || undefined,
    estado: formData.get("estado") || undefined,
  });

  await prisma.sindicato.update({
    where: { id, companyId: session.companyId },
    data: parsed,
  });

  revalidatePath("/cadastros/sindicatos");
  redirect("/cadastros/sindicatos");
}

export async function toggleSindicatoActive(id: string, active: boolean) {
  const session = await requireRole("ADMIN", "GESTOR");
  await prisma.sindicato.update({
    where: { id, companyId: session.companyId },
    data: { active },
  });
  revalidatePath("/cadastros/sindicatos");
}
