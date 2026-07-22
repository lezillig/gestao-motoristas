"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { combineLocalDateTime } from "@/lib/date";
import { readWorkbookRows, normalizeText } from "@/lib/spreadsheet";

export type ImportRowError = { row: number; message: string };
export type ImportResult = { created: number; errors: ImportRowError[] };
export type ImportState = { error?: string; result?: ImportResult };

// Aceita celula Date do ExcelJS (datetime sempre vem em UTC-meia-noite-do-
// horario, mesma convencao ja documentada em cellToLocalDateString) ou texto
// "AAAA-MM-DD HH:mm" / "AAAA-MM-DDTHH:mm". Reaproveita combineLocalDateTime
// (src/lib/date.ts) pra nao repetir a logica de fuso horario.
function parseDataHora(value: unknown): Date | null {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    const h = String(value.getUTCHours()).padStart(2, "0");
    const min = String(value.getUTCMinutes()).padStart(2, "0");
    const result = combineLocalDateTime(`${y}-${m}-${d}`, `${h}:${min}`);
    return Number.isNaN(result.getTime()) ? null : result;
  }
  const text = normalizeText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(text);
  if (!match) return null;
  const [, y, m, d, h, min] = match;
  const result = combineLocalDateTime(`${y}-${m}-${d}`, `${h}:${min}`);
  return Number.isNaN(result.getTime()) ? null : result;
}

function parseValorCents(text: string): number | null {
  const num = parseFloat(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(num) && num > 0 ? Math.round(num * 100) : null;
}

function parseLitros(text: string): number | null {
  const num = parseFloat(text.replace(",", "."));
  return Number.isFinite(num) && num > 0 ? num : null;
}

// Mesmo padrao de importDrivers/importVehicles: melhor esforco linha a
// linha, reaproveitando readWorkbookRows/normalizeText. Diferenca proposital:
// placa/motorista sem match no cadastro NAO rejeitam a linha (visibilidade
// financeira da transacao importa mais que o vinculo) — a transacao entra
// com vehicleId/driverId nulos, so marcada como "sem vinculo" na UI.
export async function importFuelTransactions(
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

  const [vehicles, drivers, existingTxs] = await Promise.all([
    prisma.vehicle.findMany({ where: { companyId: session.companyId }, select: { id: true, plate: true } }),
    prisma.driver.findMany({ where: { companyId: session.companyId }, select: { id: true, cpf: true, name: true } }),
    prisma.fuelTransaction.findMany({
      where: { companyId: session.companyId },
      select: { vehicleId: true, dataHora: true, valorCents: true },
    }),
  ]);
  const vehicleByPlate = new Map(vehicles.map((v) => [v.plate, v.id]));
  // Driver.cpf nem sempre tem so digitos — cadastro manual (DriverForm) grava
  // exatamente o que foi digitado (com pontuacao), so a importacao de planilha
  // (importDrivers) normaliza pra digitos. Normaliza os dois lados aqui pra
  // casar de qualquer jeito.
  const driverByCpf = new Map(drivers.map((d) => [d.cpf.replace(/\D/g, ""), d.id]));
  const driverByName = new Map(drivers.map((d) => [d.name.trim().toLowerCase(), d.id]));

  const DUPLICATE_TOLERANCE_CENTS = 2;
  const isDuplicate = (vehicleId: string | undefined, dataHora: Date, valorCents: number) =>
    existingTxs.some(
      (t) =>
        t.vehicleId === (vehicleId ?? null) &&
        Math.abs(t.dataHora.getTime() - dataHora.getTime()) < 60_000 &&
        Math.abs(t.valorCents - valorCents) <= DUPLICATE_TOLERANCE_CENTS
    );

  const errors: ImportRowError[] = [];
  const toCreate: {
    companyId: string;
    vehicleId: string | null;
    driverId: string | null;
    dataHora: Date;
    valorCents: number;
    volumeLitros: number;
    combustivel: string | null;
    posto: string | null;
    cidade: string | null;
    uf: string | null;
    hodometro: number | null;
    numeroAutorizacao: string | null;
    placaOriginal: string;
    motoristaOriginal: string | null;
  }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // linha 1 e o cabecalho

    const placaText = normalizeText(row["Placa"]);
    const motoristaText = normalizeText(row["Motorista (CPF ou Nome)"]);
    const valorText = normalizeText(row["Valor (R$)"]);
    const litrosText = normalizeText(row["Litros"]);
    if (!placaText && !valorText && !litrosText) continue; // linha em branco, ignora

    const dataHora = parseDataHora(row["Data/Hora (AAAA-MM-DD HH:mm)"]);
    if (!dataHora) {
      errors.push({ row: rowNumber, message: "Data/Hora ausente ou em formato inválido (use AAAA-MM-DD HH:mm)." });
      continue;
    }
    const valorCents = parseValorCents(valorText);
    if (valorCents === null) {
      errors.push({ row: rowNumber, message: "Valor (R$) ausente ou inválido." });
      continue;
    }
    const volumeLitros = parseLitros(litrosText);
    if (volumeLitros === null) {
      errors.push({ row: rowNumber, message: "Litros ausente ou inválido." });
      continue;
    }

    const placaNormalizada = placaText.toUpperCase().replace(/[\s-]/g, "");
    const vehicleId = placaNormalizada ? vehicleByPlate.get(placaNormalizada) : undefined;

    const cpfDigits = motoristaText.replace(/\D/g, "");
    const driverId =
      cpfDigits.length === 11
        ? driverByCpf.get(cpfDigits)
        : motoristaText
          ? driverByName.get(motoristaText.trim().toLowerCase())
          : undefined;

    if (isDuplicate(vehicleId, dataHora, valorCents)) {
      errors.push({ row: rowNumber, message: "Possível duplicata (mesmo veículo, data/hora e valor já importados)." });
      continue;
    }

    const hodometroText = normalizeText(row["Hodômetro (opcional)"]);
    const hodometro = hodometroText ? parseInt(hodometroText, 10) : NaN;

    toCreate.push({
      companyId: session.companyId,
      vehicleId: vehicleId ?? null,
      driverId: driverId ?? null,
      dataHora,
      valorCents,
      volumeLitros,
      combustivel: normalizeText(row["Combustível"]) || null,
      posto: normalizeText(row["Posto"]) || null,
      cidade: normalizeText(row["Cidade"]) || null,
      uf: normalizeText(row["UF"]) || null,
      hodometro: Number.isFinite(hodometro) ? hodometro : null,
      numeroAutorizacao: normalizeText(row["Nº Autorização (opcional)"]) || null,
      placaOriginal: placaText,
      motoristaOriginal: motoristaText || null,
    });
    // Evita duplicar dentro do mesmo arquivo se a mesma linha aparecer 2x.
    existingTxs.push({ vehicleId: vehicleId ?? null, dataHora, valorCents });
  }

  // createMany unico (nao um loop de create()) — mesmo cuidado ja aplicado
  // em importDriversFromTiqueTaque pra evitar timeout em arquivos grandes.
  if (toCreate.length > 0) {
    await prisma.fuelTransaction.createMany({ data: toCreate });
  }

  revalidatePath("/combustivel");
  return { result: { created: toCreate.length, errors } };
}
