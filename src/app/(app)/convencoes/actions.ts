"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { put, del, get } from "@vercel/blob";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { extractRegrasFromPdf, type SuggestedRegra } from "@/lib/cctExtraction";

export type ConvencaoFormState = { error?: string };
export type RegraFormState = { error?: string };
export type SuggestRegrasState = { error?: string; suggestions?: SuggestedRegra[] };

const convencaoSchema = z.object({
  tipo: z.enum(["CCT", "ACT"]),
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

// Vercel Blob com access "private": arquivo nao fica acessivel so pela URL,
// precisa do token do servidor (BLOB_READ_WRITE_TOKEN) pra ler — o download
// passa pela rota autenticada /api/convencoes/[id]/arquivo (ve route.ts), que
// busca do blob com esse token. Filesystem local nao serve aqui: a Vercel
// roda cada funcao serverless com filesystem read-only (so /tmp e gravavel,
// e nao persiste entre invocacoes/instancias) — confirmado real, 0
// convencoes existiam em producao ate 2026-08-24 porque o writeFile
// original nunca funcionava la.

export async function createConvencao(
  _prevState: ConvencaoFormState,
  formData: FormData
): Promise<ConvencaoFormState> {
  const session = await requireRole("ADMIN", "GESTOR");

  const parsed = convencaoSchema.safeParse({
    tipo: formData.get("tipo"),
    sindicatoId: formData.get("sindicatoId"),
    vigenciaInicio: formData.get("vigenciaInicio"),
    vigenciaFim: formData.get("vigenciaFim") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  // Confirma que o sindicato pertence a empresa do usuario ANTES de usar o id
  // como parte de um caminho de arquivo — evita tanto vincular a convencao a
  // um sindicato de outra empresa quanto usar um id nao verificado no path.
  const sindicato = await prisma.sindicato.findUnique({
    where: { id: parsed.data.sindicatoId, companyId: session.companyId },
  });
  if (!sindicato) {
    return { error: "Sindicato não encontrado." };
  }

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { error: "Selecione o arquivo PDF da convenção coletiva." };
  }
  if (arquivo.type !== "application/pdf") {
    return { error: "O arquivo precisa ser um PDF." };
  }

  const buffer = Buffer.from(await arquivo.arrayBuffer());
  // O "type" do File e informado pelo navegador/cliente e pode ser forjado;
  // confirma pela assinatura real do arquivo (magic bytes "%PDF-").
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { error: "O arquivo não é um PDF válido." };
  }

  const safeName = arquivo.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const fileName = `${Date.now()}-${safeName || "convencao.pdf"}`;
  const relativePath = `${sindicato.id}/${fileName}`;
  await put(relativePath, buffer, { access: "private", contentType: "application/pdf" });

  await prisma.convencaoColetiva.create({
    data: {
      companyId: session.companyId,
      sindicatoId: sindicato.id,
      tipo: parsed.data.tipo,
      vigenciaInicio: parsed.data.vigenciaInicio,
      vigenciaFim: parsed.data.vigenciaFim ?? null,
      fileName: arquivo.name,
      // Caminho relativo interno (nao e mais uma URL publica); o download
      // passa pela rota autenticada /api/convencoes/[id]/arquivo.
      fileUrl: relativePath,
      uploadedById: session.userId,
    },
  });

  // Fecha o vazio/sobreposicao de vigencia com a convencao imediatamente
  // anterior do MESMO sindicato+tipo (nunca mistura CCT com ACT, que tem
  // precedencia propria — ver resolveRegra em convencao.ts). Isso e uma
  // continuidade OPERACIONAL do cadastro (evita um periodo em que nenhuma
  // convencao vigente e encontrada e o sistema cai no padrao generico da
  // CLT), NAO uma aplicacao de ultratividade automatica — desde 2022 (STF,
  // ADPF 323) uma CCT/ACT vencida nao continua valendo por forca de lei so
  // por falta de uma nova. A pagina de convencoes mostra um aviso quando
  // isso acontece (ver ?prorrogada= no redirect abaixo).
  const previous = await prisma.convencaoColetiva.findFirst({
    where: {
      sindicatoId: sindicato.id,
      tipo: parsed.data.tipo,
      vigenciaInicio: { lt: parsed.data.vigenciaInicio },
    },
    orderBy: { vigenciaInicio: "desc" },
  });
  let prorrogada = false;
  if (previous) {
    const novoFim = new Date(parsed.data.vigenciaInicio);
    novoFim.setDate(novoFim.getDate() - 1);
    if (!previous.vigenciaFim || previous.vigenciaFim.getTime() !== novoFim.getTime()) {
      await prisma.convencaoColetiva.update({
        where: { id: previous.id },
        data: { vigenciaFim: novoFim },
      });
      prorrogada = true;
    }
  }

  revalidatePath("/convencoes");
  redirect(`/convencoes${prorrogada ? "?prorrogada=1" : ""}`);
}

export async function deleteConvencao(id: string) {
  const session = await requireRole("ADMIN", "GESTOR");
  const convencao = await prisma.convencaoColetiva.findUnique({
    where: { id, companyId: session.companyId },
  });
  if (!convencao) redirect("/convencoes");

  await prisma.convencaoColetiva.delete({ where: { id, companyId: session.companyId } });
  try {
    await del(convencao.fileUrl);
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

  const convencao = await prisma.convencaoColetiva.findUnique({
    where: { id: convencaoId, companyId: session.companyId },
  });
  if (!convencao) {
    return { error: "Convenção não encontrada." };
  }

  const parsed = regraSchema.safeParse({
    tipo: formData.get("tipo"),
    valorNumerico: formData.get("valorNumerico") || undefined,
    descricao: formData.get("descricao") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  await prisma.regraConvencao.create({
    data: { ...parsed.data, convencaoId: convencao.id, companyId: session.companyId },
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
    const blob = await get(convencao.fileUrl, { access: "private" });
    if (!blob || blob.statusCode !== 200) return { error: "Arquivo da convenção não encontrado." };
    const buffer = Buffer.from(await new Response(blob.stream).arrayBuffer());
    const suggestions = await extractRegrasFromPdf(buffer);
    return { suggestions };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao processar o PDF com IA." };
  }
}
