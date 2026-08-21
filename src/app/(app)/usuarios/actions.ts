"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// CONTROLADORIA faltava aqui e no formulário, embora exista no banco desde que
// o módulo financeiro foi criado. O efeito era silencioso e sério: não havia
// como conceder o perfil que existe exatamente para dar acesso ao financeiro
// sem expor ponto, escala e dado pessoal de motorista. Quem precisava do
// financeiro — contador, terceirizado — só podia entrar como ADMIN ou GESTOR,
// que enxergam tudo.
const ROLE_VALUES = ["ADMIN", "GESTOR", "FOLHA", "CONTROLADORIA", "MOTORISTA"] as const;

const dadosBase = {
  name: z.string().min(2, "Informe o nome"),
  email: z.string().email("E-mail inválido"),
  role: z.enum(ROLE_VALUES),
};

const schemaCriacao = z.object({
  ...dadosBase,
  password: z.string().min(6, "A senha precisa ter ao menos 6 caracteres"),
});

// Na alteração a senha é opcional: deixar em branco significa "manter a
// atual". Exigir a senha para trocar um nome obrigaria o administrador a
// inventar uma nova e comunicá-la à pessoa, o que troca um dado errado por um
// transtorno.
const schemaAlteracao = z.object({
  ...dadosBase,
  password: z
    .string()
    .refine((v) => v === "" || v.length >= 6, "A senha precisa ter ao menos 6 caracteres")
    .optional(),
});

export async function createUser(formData: FormData) {
  const session = await requireRole("ADMIN");
  const parsed = schemaCriacao.parse({
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

// Quantos administradores ATIVOS restariam se este usuário deixasse de ser um.
//
// Só ADMIN gerencia contas. Zerar os administradores tranca a empresa inteira
// para fora da gestão de acessos, e a única saída seria mexer no banco — que é
// exatamente o tipo de manobra que um sistema com trilha de auditoria existe
// para evitar.
async function restariaSemAdmin(companyId: string, idQueDeixaDeSerAdmin: string): Promise<boolean> {
  const outros = await prisma.user.count({
    where: { companyId, role: "ADMIN", active: true, NOT: { id: idQueDeixaDeSerAdmin } },
  });
  return outros === 0;
}

export async function updateUser(id: string, formData: FormData) {
  const session = await requireRole("ADMIN");

  const parsed = schemaAlteracao.parse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password") ?? "",
    role: formData.get("role"),
  });

  const alvo = await prisma.user.findFirst({
    where: { id, companyId: session.companyId },
    select: { id: true, role: true, active: true },
  });
  if (!alvo) throw new Error("Usuário não encontrado.");

  // E-mail é a chave de login: duplicar deixaria uma das duas contas
  // inacessível, e a mensagem de erro do banco não diria isso a ninguém.
  const conflito = await prisma.user.findFirst({
    where: { email: parsed.email, NOT: { id } },
    select: { id: true },
  });
  if (conflito) throw new Error("Já existe outro usuário com esse e-mail.");

  if (id === session.userId && parsed.role !== "ADMIN") {
    throw new Error(
      "Você não pode retirar o próprio acesso de administrador — ficaria sem como reverter. Peça a outro administrador."
    );
  }

  if (alvo.role === "ADMIN" && parsed.role !== "ADMIN" && (await restariaSemAdmin(session.companyId, id))) {
    throw new Error("Este é o último administrador ativo. Promova outra pessoa antes de mudar o acesso desta.");
  }

  const senha = parsed.password?.trim();
  await prisma.user.update({
    where: { id },
    data: {
      name: parsed.name,
      email: parsed.email,
      role: parsed.role,
      ...(senha ? { passwordHash: await bcrypt.hash(senha, 10) } : {}),
    },
  });

  revalidatePath("/usuarios");
  redirect("/usuarios");
}

// Desativa em vez de apagar, sempre.
//
// Apagar quebraria o histórico: aprovação, tratativa de achado e evento de
// auditoria apontam para quem fez. Num setor com fiscalização trabalhista, um
// registro órfão vale menos que nenhum — não se sabe se ninguém fez ou se
// alguém apagou. Desativado, a pessoa perde o acesso na hora e o histórico
// continua íntegro.
export async function toggleUserActive(id: string, active: boolean) {
  const session = await requireRole("ADMIN");

  if (id === session.userId && !active) {
    throw new Error("Você não pode desativar sua própria conta.");
  }

  if (!active) {
    const alvo = await prisma.user.findFirst({
      where: { id, companyId: session.companyId },
      select: { role: true },
    });
    if (alvo?.role === "ADMIN" && (await restariaSemAdmin(session.companyId, id))) {
      throw new Error("Este é o último administrador ativo. Promova outra pessoa antes de desativar esta conta.");
    }
  }

  await prisma.user.update({
    where: { id, companyId: session.companyId },
    data: { active },
  });
  revalidatePath("/usuarios");
}
