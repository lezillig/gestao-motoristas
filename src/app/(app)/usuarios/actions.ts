"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ROLE_VALUES = ["ADMIN", "GESTOR", "FOLHA", "MOTORISTA"] as const;

const schema = z.object({
  name: z.string().min(2, "Informe o nome"),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "A senha precisa ter ao menos 6 caracteres"),
  role: z.enum(ROLE_VALUES),
});

export async function createUser(formData: FormData) {
  const session = await requireRole("ADMIN");
  const parsed = schema.parse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) {
    throw new Error("Já existe um usuário com esse e-mail.");
  }

  const passwordHash = await bcrypt.hash(parsed.password, 10);
  await prisma.user.create({
    data: {
      companyId: session.companyId,
      name: parsed.name,
      email: parsed.email,
      passwordHash,
      role: parsed.role,
    },
  });

  revalidatePath("/usuarios");
  redirect("/usuarios");
}

export async function toggleUserActive(id: string, active: boolean) {
  const session = await requireRole("ADMIN");
  // Nunca permite o admin se auto-desativar por engano (ficaria sem acesso
  // para reverter, ja que so ADMIN pode gerenciar usuarios).
  if (id === session.userId && !active) {
    throw new Error("Você não pode desativar sua própria conta.");
  }
  await prisma.user.update({
    where: { id, companyId: session.companyId },
    data: { active },
  });
  revalidatePath("/usuarios");
}

export async function deleteUser(id: string) {
  const session = await requireRole("ADMIN");
  if (id === session.userId) {
    throw new Error("Você não pode excluir sua própria conta.");
  }

  const user = await prisma.user.findUnique({ where: { id, companyId: session.companyId } });
  if (!user) return;

  // ConvencaoColetiva.uploadedById e obrigatorio — nunca apaga em cascata
  // um documento de convencao coletiva so por causa da conta que o
  // enviou. Bloqueia com uma mensagem clara em vez disso.
  const convencoesEnviadas = await prisma.convencaoColetiva.count({ where: { uploadedById: id } });
  if (convencoesEnviadas > 0) {
    throw new Error(
      `Não é possível excluir: ${user.name} enviou ${convencoesEnviadas} convenção(ões) coletiva(s). Inative a conta em vez de excluir.`
    );
  }

  // Driver.userId e opcional — so desvincula o cadastro de motorista, nao
  // apaga o motorista.
  await prisma.driver.updateMany({ where: { userId: id }, data: { userId: null } });
  await prisma.user.delete({ where: { id } });

  revalidatePath("/usuarios");
}
