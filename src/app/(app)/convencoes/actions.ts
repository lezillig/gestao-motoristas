"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { extractRegrasFromPdf, type SuggestedRegra } from "@/lib/cctExtraction";

export type ConvencaoFormState = { error?: string };
export type RegraFormState = { error?: string };
export type SuggestRegrasState = { error?: string; suggestions?: SuggestedRegra[] };

const convencaoSchema = z.object({
  sindicatoId: z.string().min(1, "Selecione o sindicato"),
  vigenciaInicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .transform(parseLocalDate),
  vigenciaFim: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .transform(parseLocalDate)
    .optional(),
});

export async function createConvencao(
  _prevState: ConvencaoFormState,
  formData: FormData
): Promise<ConvencaoFormState> {
  const session = await requireRole("ADMIN", "GESTOR");

  const parsed = convencaoSchema.safeParse({
    sindicatoId: formData.get("sindicatoId"),
    vigenciaInicio: formData.get("vigenciaInicio"),
    vigenciaFim: formData.get("vigenciaFim") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { error: "Selecione o arquivo PDF da convenção coletiva." };
  }
  if (arquivo.type !== "application/pdf") {
    return { error: "O arquivo precisa ser um PDF." };
  }

  const safeName = arquivo.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const fileName = `${Date.now()}-${safeName || "convencao.pdf"}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads", "convencoes", parsed.data.sindicatoId);
  await mkdir(uploadDir, { recursive: true });
  const buffer = Buffer.from(await arquivo.arrayBuffer());
  await writeFile(path.join(uploadDir, fileName), buffer);

  await prisma.convencaoColetiva.create({
    data: {
      companyId: session.companyId,
      sindicatoId: parsed.data.sindicatoId,
      vigenciaInicio: parsed.data.vigenciaInicio,
      vigenciaFim: parsed.data.vigenciaFim ?? null,
      fileName: arquivo.name,
      fileUrl: `/uploads/convencoes/${parsed.data.sindicatoId}/${fileName}`,
      uploadedById: session.userId,
    },
  });

  revalidatePath("/convencoes");
  redirect("/convencoes");
}

export async function deleteConvencao(id: string) {
  const session = await requireRole("ADMIN", "GESTOR");
  const convencao = await prisma.convencaoColetiva.findUnique({
    where: { id, companyId: session.companyId },
  });
  if (!convencao) redirect("/convencoes");

  await prisma.convencaoColetiva.delete({ where: { id, companyId: session.companyId } });
  try {
    await unlink(path.join(process.cwd(), "public", convencao.fileUrl.replace(/^\//, "")));
  } catch {
    // arquivo ja pode ter sido removido manualmente; nao bloqueia a exclusao do registro
  }

  revalidatePath("/convencoes");
  redirect("/convencoes");
}

const regraSchema = z.object({
  tipo: z.enum([
    "JORNADA_DIARIA",
    "HORA_EXTRA",
    "BANCO_HORAS",
    "ADICIONAL_NOTURNO",
    "INTERVALO",
    "JORNADA_12X36",
    "OUTRO",
  ]),
  valorNumerico: z.coerce.number().optional(),
  descricao: z.string().optional(),
});

export async function addRegra(
  convencaoId: string,
  _prevState: RegraFormState,
  formData: FormData
): Promise<RegraFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = regraSchema.safeParse({
    tipo: formData.get("tipo"),
    valorNumerico: formData.get("valorNumerico") || undefined,
    descricao: formData.get("descricao") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  await prisma.regraConvencao.create({
    data: { ...parsed.data, convencaoId, companyId: session.companyId },
  });

  revalidatePath(`/convencoes/${convencaoId}`);
  return {};
}

// Mesma criacao de addRegra, mas com assinatura de form action simples (sem
// useActionState) — usada pelos botoes "Adicionar" das sugestoes de IA, que
// nao precisam exibir estado de erro por sugestao individual.
export async function addRegraPlain(convencaoId: string, formData: FormData) {
  await addRegra(convencaoId, {}, formData);
}

export async function removeRegra(convencaoId: string, id: string) {
  const session = await requireRole("ADMIN", "GESTOR");
  await prisma.regraConvencao.delete({ where: { id, companyId: session.companyId } });
  revalidatePath(`/convencoes/${convencaoId}`);
}

export async function suggestRegrasFromCct(
  convencaoId: string,
  _prevState: SuggestRegrasState,
  _formData: FormData
): Promise<SuggestRegrasState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const convencao = await prisma.convencaoColetiva.findUnique({
    where: { id: convencaoId, companyId: session.companyId },
  });
  if (!convencao) return { error: "Convenção não encontrada." };

  try {
    const filePath = path.join(process.cwd(), "public", convencao.fileUrl.replace(/^\//, ""));
    const suggestions = await extractRegrasFromPdf(filePath);
    return { suggestions };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao processar o PDF com IA." };
  }
}
