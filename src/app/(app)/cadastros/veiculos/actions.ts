"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkbookRows, normalizeText } from "@/lib/spreadsheet";

export type VehicleFormState = { error?: string };

const schema = z.object({
  plate: z.string().min(6, "Placa inválida").toUpperCase(),
  brand: z.string().min(1, "Informe a marca"),
  model: z.string().min(1, "Informe o modelo"),
  year: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.coerce.number().int().min(1980).max(2100).optional()
  ),
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

function vehicleErrorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Dados inválidos.";
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return "Já existe outro veículo cadastrado com essa placa.";
  }
  return "Falha ao salvar veículo.";
}

export async function createVehicle(
  _prevState: VehicleFormState,
  formData: FormData
): Promise<VehicleFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  try {
    const parsed = parseForm(formData);
    await prisma.vehicle.create({
      data: { ...parsed, companyId: session.companyId },
    });
  } catch (e) {
    return { error: vehicleErrorMessage(e) };
  }

  revalidatePath("/cadastros/veiculos");
  redirect("/cadastros/veiculos");
}

export async function updateVehicle(
  id: string,
  _prevState: VehicleFormState,
  formData: FormData
): Promise<VehicleFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  try {
    const parsed = parseForm(formData);
    await prisma.vehicle.update({
      where: { id, companyId: session.companyId },
      data: parsed,
    });
  } catch (e) {
    return { error: vehicleErrorMessage(e) };
  }

  revalidatePath("/cadastros/veiculos");
  redirect("/cadastros/veiculos");
}

export type ImportRowError = { row: number; message: string };
export type ImportResult = { created: number; errors: ImportRowError[] };
export type ImportState = { error?: string; result?: ImportResult };

function normalizeStatus(value: string): "ATIVO" | "MANUTENCAO" | "INATIVO" | null {
  const v = value.trim().toLowerCase();
  if (!v || v === "ativo") return "ATIVO";
  if (v === "inativo") return "INATIVO";
  if (v === "manutencao" || v === "manutenção" || v === "em manutencao" || v === "em manutenção") {
    return "MANUTENCAO";
  }
  return null;
}

// Mesma validacao de createVehicle, linha a linha, com melhor esforco: linhas
// invalidas viram erro reportado ao usuario, mas nao bloqueiam a importacao
// das linhas validas do resto da planilha.
export async function importVehicles(
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

  const existingPlates = new Set(
    (
      await prisma.vehicle.findMany({
        where: { companyId: session.companyId },
        select: { plate: true },
      })
    ).map((v) => v.plate)
  );

  const errors: ImportRowError[] = [];
  let created = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // linha 1 e o cabecalho

    const plate = normalizeText(row["Placa"]).toUpperCase().replace(/\s+/g, "");
    const brand = normalizeText(row["Marca"]);
    const model = normalizeText(row["Modelo"]);
    if (!plate && !brand && !model) continue; // linha em branco, ignora

    const yearText = normalizeText(row["Ano"]);
    const type = normalizeText(row["Tipo"]);
    const statusText = normalizeText(row["Status"]);
    const status = normalizeStatus(statusText);

    if (statusText && !status) {
      errors.push({ row: rowNumber, message: `Status "${statusText}" inválido (use Ativo, Manutenção ou Inativo)` });
      continue;
    }

    const parsed = schema.safeParse({
      plate,
      brand,
      model,
      year: yearText,
      type,
      status: status ?? "ATIVO",
    });
    if (!parsed.success) {
      errors.push({ row: rowNumber, message: parsed.error.issues[0]?.message ?? "Dados inválidos" });
      continue;
    }
    if (existingPlates.has(parsed.data.plate)) {
      errors.push({ row: rowNumber, message: `Placa ${parsed.data.plate} já cadastrada` });
      continue;
    }

    try {
      await prisma.vehicle.create({ data: { ...parsed.data, companyId: session.companyId } });
      existingPlates.add(parsed.data.plate);
      created++;
    } catch {
      errors.push({ row: rowNumber, message: "Erro ao salvar a linha (placa duplicada?)" });
    }
  }

  revalidatePath("/cadastros/veiculos");
  return { result: { created, errors } };
}
