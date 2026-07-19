"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { readWorkbookRows, normalizeText, cellToLocalDateString } from "@/lib/spreadsheet";

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
  regimeHoras: z.enum(["PADRAO", "DOZE_X_TRINTA_SEIS"]).optional(),
  escalaSemanal: z.enum(["SEIS_UM", "CINCO_DOIS"]).optional(),
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
    regimeHoras: formData.get("regimeHoras") || undefined,
    escalaSemanal: formData.get("escalaSemanal") || undefined,
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

export type ImportRowError = { row: number; message: string };
export type ImportResult = { created: number; errors: ImportRowError[] };
export type ImportState = { error?: string; result?: ImportResult };

function normalizeRegimeHoras(value: string): "PADRAO" | "DOZE_X_TRINTA_SEIS" | null {
  const v = value.trim().toLowerCase();
  if (v === "padrao" || v === "padrão") return "PADRAO";
  if (v === "12x36" || v === "12 x 36") return "DOZE_X_TRINTA_SEIS";
  return null;
}

function normalizeEscalaSemanal(value: string): "SEIS_UM" | "CINCO_DOIS" | null {
  const v = value.trim().toLowerCase();
  if (v === "6x1" || v === "6 x 1") return "SEIS_UM";
  if (v === "5x2" || v === "5 x 2") return "CINCO_DOIS";
  return null;
}

// Mesma validacao de createDriver, linha a linha, com melhor esforco: linhas
// invalidas viram erro reportado ao usuario, mas nao bloqueiam a importacao
// das linhas validas do resto da planilha.
export async function importDrivers(
  _prevState: ImportState,
  formData: FormData
): Promise<ImportState> {
  const session = await requireRole("ADMIN", "GESTOR");

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { error: "Selecione o arquivo da planilha (.xlsx)." };
  }

  let rows: Record<string, unknown>[];
  try {
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    rows = await readWorkbookRows(buffer);
  } catch {
    return { error: "Não foi possível ler o arquivo. Baixe o modelo de planilha e tente novamente." };
  }
  if (rows.length === 0) {
    return { error: "A planilha está vazia." };
  }

  const sindicatos = await prisma.sindicato.findMany({
    where: { companyId: session.companyId },
    select: { id: true, nome: true },
  });
  const sindicatoByName = new Map(sindicatos.map((s) => [s.nome.trim().toLowerCase(), s.id]));
  const existingCpfs = new Set(
    (
      await prisma.driver.findMany({
        where: { companyId: session.companyId },
        select: { cpf: true },
      })
    ).map((d) => d.cpf)
  );

  const errors: ImportRowError[] = [];
  let created = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // linha 1 e o cabecalho

    const name = normalizeText(row["Nome"]);
    const cpf = normalizeText(row["CPF"]).replace(/\D/g, "");
    const cnh = normalizeText(row["CNH"]);
    if (!name && !cpf && !cnh) continue; // linha em branco, ignora

    const cnhCategory = normalizeText(row["Categoria CNH"]);
    const cnhExpiration = cellToLocalDateString(row["Validade CNH (AAAA-MM-DD)"]);
    const phone = normalizeText(row["Telefone"]) || undefined;
    const sindicatoNome = normalizeText(row["Sindicato"]);
    const ativoRaw = normalizeText(row["Ativo (SIM/NAO)"]).toLowerCase();
    const regimeHorasText = normalizeText(row["Regime de Horas"]);
    const escalaSemanalText = normalizeText(row["Escala"]);

    let sindicatoId: string | undefined;
    if (sindicatoNome) {
      const match = sindicatoByName.get(sindicatoNome.toLowerCase());
      if (!match) {
        errors.push({ row: rowNumber, message: `Sindicato "${sindicatoNome}" não encontrado` });
        continue;
      }
      sindicatoId = match;
    }

    const regimeHoras = regimeHorasText ? normalizeRegimeHoras(regimeHorasText) : undefined;
    if (regimeHorasText && !regimeHoras) {
      errors.push({ row: rowNumber, message: `Regime de horas "${regimeHorasText}" inválido (use Padrão ou 12x36)` });
      continue;
    }
    const escalaSemanal = escalaSemanalText ? normalizeEscalaSemanal(escalaSemanalText) : undefined;
    if (escalaSemanalText && !escalaSemanal) {
      errors.push({ row: rowNumber, message: `Escala "${escalaSemanalText}" inválida (use 6x1 ou 5x2)` });
      continue;
    }

    const parsed = schema.safeParse({
      name,
      cpf,
      cnh,
      cnhCategory,
      cnhExpiration: cnhExpiration ?? "",
      phone,
      sindicatoId,
      regimeHoras: regimeHoras ?? undefined,
      escalaSemanal: escalaSemanal ?? undefined,
    });
    if (!parsed.success) {
      errors.push({ row: rowNumber, message: parsed.error.issues[0]?.message ?? "Dados inválidos" });
      continue;
    }
    if (existingCpfs.has(parsed.data.cpf)) {
      errors.push({ row: rowNumber, message: `CPF ${parsed.data.cpf} já cadastrado` });
      continue;
    }

    try {
      await prisma.driver.create({
        data: {
          ...parsed.data,
          active: ativoRaw !== "nao" && ativoRaw !== "não",
          companyId: session.companyId,
        },
      });
      existingCpfs.add(parsed.data.cpf);
      created++;
    } catch {
      errors.push({ row: rowNumber, message: "Erro ao salvar a linha (CPF duplicado?)" });
    }
  }

  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
  return { result: { created, errors } };
}
