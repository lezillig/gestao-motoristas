"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkbookRows, normalizeText } from "@/lib/spreadsheet";

const schema = z.object({
  nome: z.string().min(2, "Informe o nome do cliente"),
  horarioInicioContratado: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  horarioFimContratado: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});

function parseClienteForm(formData: FormData) {
  return schema.parse({
    nome: formData.get("nome"),
    horarioInicioContratado: formData.get("horarioInicioContratado") || undefined,
    horarioFimContratado: formData.get("horarioFimContratado") || undefined,
  });
}

export async function createCliente(formData: FormData) {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseClienteForm(formData);

  await prisma.cliente.create({
    data: { ...parsed, companyId: session.companyId },
  });

  revalidatePath("/cadastros/clientes");
  redirect("/cadastros/clientes");
}

export async function updateCliente(id: string, formData: FormData) {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseClienteForm(formData);

  await prisma.cliente.update({
    where: { id, companyId: session.companyId },
    data: parsed,
  });

  revalidatePath("/cadastros/clientes");
  redirect("/cadastros/clientes");
}

export async function toggleClienteActive(id: string, active: boolean) {
  const session = await requireRole("ADMIN", "GESTOR");
  await prisma.cliente.update({
    where: { id, companyId: session.companyId },
    data: { active },
  });
  revalidatePath("/cadastros/clientes");
}

// ---------- Importação de centro de custo (planilha financeira/RH) ----------
// Deliberadamente separado do vínculo Driver.departamento (sincronizado
// automaticamente do TiqueTaque) — ver comentário no schema em Cliente.
// Fluxo em 2 passos porque a planilha real tem grafias inconsistentes do
// mesmo cliente (ex. "Fretamento Eventual" sem hífen vs "Fretamento -
// Eventual") que um normalize simples não resolve sozinho — o usuário revisa
// e funde manualmente antes de confirmar.

export type ClienteImportRow = { row: number; driverId: string; groupKey: string };
export type ClienteImportGroup = {
  key: string;
  suggestedNome: string;
  count: number;
  existingClienteId: string | null;
};
export type PrepareClienteImportResult =
  | { error: string }
  | {
      groups: ClienteImportGroup[];
      rows: ClienteImportRow[];
      rowErrors: { row: number; message: string }[];
    };

// Chave de agrupamento: maiúsculas + espaços colapsados. Não remove hífen —
// grafias sem hífen (ex. "Fretamento Eventual") ficam em grupo separado de
// propósito, pro usuário fundir manualmente na tela de revisão em vez do
// sistema adivinhar.
function groupKeyFor(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

export async function prepareClienteImport(formData: FormData): Promise<PrepareClienteImportResult> {
  const session = await requireRole("ADMIN", "GESTOR");

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { error: "Selecione o arquivo da planilha (.xlsx)." };
  }

  let rawRows: Record<string, unknown>[];
  try {
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    rawRows = await readWorkbookRows(buffer);
  } catch {
    return { error: "Não foi possível ler o arquivo. Confira se é um .xlsx válido." };
  }
  if (rawRows.length === 0) {
    return { error: "A planilha está vazia." };
  }

  const drivers = await prisma.driver.findMany({
    where: { companyId: session.companyId },
    select: { id: true, cpf: true },
  });
  // CPF pode vir de célula numérica na planilha (perde zero à esquerda) e o
  // Driver.cpf já cadastrado pode ou não ter pontuação, dependendo de como
  // foi criado — normaliza os dois lados pra dígitos-só + zero à esquerda
  // antes de comparar (mesmo cuidado do bug real já corrigido em
  // combustivel/actions.ts pra esse mesmo tipo de comparação de CPF).
  const driverByCpf = new Map(drivers.map((d) => [d.cpf.replace(/\D/g, "").padStart(11, "0"), d]));

  const existingClientes = await prisma.cliente.findMany({
    where: { companyId: session.companyId },
    select: { id: true, nome: true },
  });
  const existingByGroupKey = new Map(existingClientes.map((c) => [groupKeyFor(c.nome), c.id]));

  const rows: ClienteImportRow[] = [];
  const rowErrors: { row: number; message: string }[] = [];
  const groupsByKey = new Map<string, ClienteImportGroup>();

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowNumber = i + 2; // linha 1 e o cabecalho
    const nome = normalizeText(raw["Nome"]);
    const cpfDigits = normalizeText(raw["CPF"]).replace(/\D/g, "");
    const centroCustoRaw = normalizeText(raw["Centro de custo - Atual"]);
    if (!nome && !cpfDigits) continue; // linha em branco, ignora

    if (!centroCustoRaw) {
      rowErrors.push({ row: rowNumber, message: `${nome || "linha sem nome"}: sem centro de custo preenchido` });
      continue;
    }
    if (!cpfDigits) {
      rowErrors.push({ row: rowNumber, message: `${nome || "linha sem nome"}: sem CPF preenchido` });
      continue;
    }

    const cpf = cpfDigits.padStart(11, "0");
    const driver = driverByCpf.get(cpf);
    if (!driver) {
      rowErrors.push({ row: rowNumber, message: `${nome || cpf}: nenhum motorista/funcionário cadastrado com o CPF ${cpf}` });
      continue;
    }

    const groupKey = groupKeyFor(centroCustoRaw);
    let group = groupsByKey.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        suggestedNome: centroCustoRaw,
        count: 0,
        existingClienteId: existingByGroupKey.get(groupKey) ?? null,
      };
      groupsByKey.set(groupKey, group);
    }
    group.count++;

    rows.push({ row: rowNumber, driverId: driver.id, groupKey });
  }

  const groups = [...groupsByKey.values()].sort((a, b) => b.count - a.count);

  return { groups, rows, rowErrors };
}

export type CommitClienteImportResult = { error: string } | { clientesCriados: number; motoristasVinculados: number };

export async function commitClienteImport(formData: FormData): Promise<CommitClienteImportResult> {
  const session = await requireRole("ADMIN", "GESTOR");

  const payloadRaw = formData.get("payload");
  if (typeof payloadRaw !== "string") {
    return { error: "Dados da importação perdidos — volte e envie o arquivo de novo." };
  }
  let parsed: { groups: ClienteImportGroup[]; rows: ClienteImportRow[] };
  try {
    parsed = JSON.parse(payloadRaw);
  } catch {
    return { error: "Dados da importação corrompidos — volte e envie o arquivo de novo." };
  }

  const finalNameByGroupKey = new Map<string, string>();
  for (const group of parsed.groups) {
    const edited = normalizeText(formData.get(`nome_${group.key}`));
    finalNameByGroupKey.set(group.key, edited || group.suggestedNome);
  }

  // Dois grupos brutos diferentes podem ter sido fundidos pelo usuário
  // editando os dois pro mesmo nome final — agrupa por nome final
  // normalizado antes de criar Cliente, senão criaria clientes duplicados.
  const driverIdsByFinalKey = new Map<string, { finalName: string; driverIds: Set<string> }>();
  for (const row of parsed.rows) {
    const finalName = finalNameByGroupKey.get(row.groupKey) ?? row.groupKey;
    const finalKey = groupKeyFor(finalName);
    let entry = driverIdsByFinalKey.get(finalKey);
    if (!entry) {
      entry = { finalName, driverIds: new Set() };
      driverIdsByFinalKey.set(finalKey, entry);
    }
    entry.driverIds.add(row.driverId);
  }

  const existingClientes = await prisma.cliente.findMany({
    where: { companyId: session.companyId },
    select: { id: true, nome: true },
  });
  const existingByGroupKey = new Map(existingClientes.map((c) => [groupKeyFor(c.nome), c.id]));

  let clientesCriados = 0;
  let motoristasVinculados = 0;

  for (const [finalKey, { finalName, driverIds }] of driverIdsByFinalKey) {
    let clienteId = existingByGroupKey.get(finalKey);
    if (!clienteId) {
      const created = await prisma.cliente.create({
        data: { companyId: session.companyId, nome: finalName },
      });
      clienteId = created.id;
      existingByGroupKey.set(finalKey, clienteId);
      clientesCriados++;
    }
    const result = await prisma.driver.updateMany({
      where: { id: { in: [...driverIds] }, companyId: session.companyId },
      data: { clienteId },
    });
    motoristasVinculados += result.count;
  }

  revalidatePath("/cadastros/clientes");
  revalidatePath("/cadastros/motoristas");

  return { clientesCriados, motoristasVinculados };
}
