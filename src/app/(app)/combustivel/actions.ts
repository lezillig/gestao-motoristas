"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { combineLocalDateTime } from "@/lib/date";
import { readWorkbookRows, normalizeText } from "@/lib/spreadsheet";
import { anpWeekRange, fetchAnpWeek } from "@/lib/anp/client";

export type ImportRowError = { row: number; message: string };
// naoAbastecimento e opcional (so o extrato real RFCV preenche) — o
// ImportSpreadsheetForm compartilhado (Motoristas/Veiculos) so mostra
// created/errors, ignora campos extras com seguranca.
export type ImportResult = { created: number; errors: ImportRowError[]; naoAbastecimento?: number };
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

// Extrato real do sistema de frota (RFCV) — diferente do template manual:
// a celula "DATA TRANSACAO" e um datetime completo, e o Date que o ExcelJS
// devolve ja tem os getters LOCAIS certos (verificado com o arquivo real:
// bruto "Thu Jan 01 2026 14:35:18", getHours() local = 14, getUTCHours() =
// 17). NAO aplicar a extracao via UTC usada em parseDataHora (essa e so
// pra celula de data-só, que sofre o bug contrario) — faria isso ficar 3h
// errado.
function parseDataHoraReal(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

function toNumberBR(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const num = parseFloat(normalizeText(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

type FuelTxDraft = {
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
  kmRodados: number | null;
  numeroAutorizacao: string | null;
  codigoTransacao: string | null;
  placaOriginal: string;
  motoristaOriginal: string | null;
  modeloOriginal: string | null;
};

function matchVehicleAndDriver(
  placaText: string,
  motoristaText: string,
  vehicleByPlate: Map<string, string>,
  driverByCpf: Map<string, string>,
  driverByName: Map<string, string>
): { vehicleId: string | undefined; driverId: string | undefined } {
  const placaNormalizada = placaText.toUpperCase().replace(/[\s-]/g, "");
  const vehicleId = placaNormalizada ? vehicleByPlate.get(placaNormalizada) : undefined;

  const cpfDigits = motoristaText.replace(/\D/g, "");
  const driverId =
    cpfDigits.length === 11
      ? driverByCpf.get(cpfDigits)
      : motoristaText
        ? driverByName.get(motoristaText.trim().toLowerCase())
        : undefined;

  return { vehicleId, driverId };
}

// Mesmo padrao de importDrivers/importVehicles: melhor esforco linha a
// linha, reaproveitando readWorkbookRows/normalizeText. Diferenca proposital:
// placa/motorista sem match no cadastro NAO rejeitam a linha (visibilidade
// financeira da transacao importa mais que o vinculo) — a transacao entra
// com vehicleId/driverId nulos, so marcada como "sem vinculo" na UI.
//
// Aceita 2 formatos, auto-detectados pela presenca da coluna real
// "CODIGO TRANSACAO": o extrato real do sistema de frota (RFCV), OU o
// template manual proprio (planilha que o usuario preenche a mao). O
// usuario nao precisa saber qual esta mandando — o mesmo botao/pagina
// aceita os dois.
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

  const isRfcv = Object.prototype.hasOwnProperty.call(rows[0], "CODIGO TRANSACAO");

  const [vehicles, drivers, existingTxs, existingCodigos] = await Promise.all([
    prisma.vehicle.findMany({ where: { companyId: session.companyId }, select: { id: true, plate: true } }),
    prisma.driver.findMany({ where: { companyId: session.companyId }, select: { id: true, cpf: true, name: true } }),
    prisma.fuelTransaction.findMany({
      where: { companyId: session.companyId },
      select: { vehicleId: true, dataHora: true, valorCents: true },
    }),
    prisma.fuelTransaction.findMany({
      where: { codigoTransacao: { not: null } },
      select: { codigoTransacao: true },
    }),
  ]);
  const vehicleByPlate = new Map(vehicles.map((v) => [v.plate, v.id]));
  // Driver.cpf nem sempre tem so digitos — cadastro manual (DriverForm) grava
  // exatamente o que foi digitado (com pontuacao), so a importacao de planilha
  // (importDrivers) normaliza pra digitos. Normaliza os dois lados aqui pra
  // casar de qualquer jeito.
  const driverByCpf = new Map(drivers.map((d) => [d.cpf.replace(/\D/g, ""), d.id]));
  const driverByName = new Map(drivers.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const codigosVistos = new Set(existingCodigos.map((t) => t.codigoTransacao as string));

  const DUPLICATE_TOLERANCE_CENTS = 2;
  const isDuplicate = (vehicleId: string | undefined, dataHora: Date, valorCents: number) =>
    existingTxs.some(
      (t) =>
        t.vehicleId === (vehicleId ?? null) &&
        Math.abs(t.dataHora.getTime() - dataHora.getTime()) < 60_000 &&
        Math.abs(t.valorCents - valorCents) <= DUPLICATE_TOLERANCE_CENTS
    );

  const errors: ImportRowError[] = [];
  const toCreate: FuelTxDraft[] = [];
  let naoAbastecimento = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // linha 1 e o cabecalho

    if (isRfcv) {
      const placaText = normalizeText(row["PLACA"]);
      const motoristaText = normalizeText(row["NOME MOTORISTA"]);
      if (!placaText) continue; // linha em branco, ignora

      const servico = normalizeText(row["SERVICO"]).toLowerCase();
      if (servico && servico !== "abastecimento") {
        naoAbastecimento++;
        continue;
      }

      const dataHora = parseDataHoraReal(row["DATA TRANSACAO"]);
      if (!dataHora) {
        errors.push({ row: rowNumber, message: "DATA TRANSACAO ausente ou inválida." });
        continue;
      }
      const valor = toNumberBR(row["VALOR EMISSAO"]);
      if (valor === null || valor <= 0) {
        errors.push({ row: rowNumber, message: "VALOR EMISSAO ausente ou inválido." });
        continue;
      }
      const volumeLitros = toNumberBR(row["LITROS"]);
      if (volumeLitros === null || volumeLitros <= 0) {
        errors.push({ row: rowNumber, message: "LITROS ausente ou inválido." });
        continue;
      }
      const valorCents = Math.round(valor * 100);

      const codigoTransacao = normalizeText(row["CODIGO TRANSACAO"]) || null;
      if (codigoTransacao && codigosVistos.has(codigoTransacao)) {
        errors.push({ row: rowNumber, message: `Transação ${codigoTransacao} já importada.` });
        continue;
      }

      const { vehicleId, driverId } = matchVehicleAndDriver(
        placaText,
        motoristaText,
        vehicleByPlate,
        driverByCpf,
        driverByName
      );

      toCreate.push({
        companyId: session.companyId,
        vehicleId: vehicleId ?? null,
        driverId: driverId ?? null,
        dataHora,
        valorCents,
        volumeLitros,
        combustivel: normalizeText(row["TIPO COMBUSTIVEL"]) || null,
        posto: normalizeText(row["NOME ESTABELECIMENTO"]) || null,
        cidade: normalizeText(row["CIDADE"]) || null,
        uf: normalizeText(row["UF"]) || null,
        hodometro: toNumberBR(row["HODOMETRO OU HORIMETRO"]),
        kmRodados: toNumberBR(row["KM RODADOS OU HORAS TRABALHADAS"]),
        numeroAutorizacao: null,
        codigoTransacao,
        placaOriginal: placaText,
        motoristaOriginal: motoristaText || null,
        modeloOriginal: normalizeText(row["MODELO VEICULO"]) || null,
      });
      if (codigoTransacao) codigosVistos.add(codigoTransacao);
      continue;
    }

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

    const { vehicleId, driverId } = matchVehicleAndDriver(
      placaText,
      motoristaText,
      vehicleByPlate,
      driverByCpf,
      driverByName
    );

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
      kmRodados: null,
      numeroAutorizacao: normalizeText(row["Nº Autorização (opcional)"]) || null,
      codigoTransacao: null,
      placaOriginal: placaText,
      motoristaOriginal: motoristaText || null,
      modeloOriginal: null,
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
  return {
    result: {
      created: toCreate.length,
      errors,
      naoAbastecimento: isRfcv ? naoAbastecimento : undefined,
    },
  };
}

// Busca sob demanda (nunca automatico a cada render de pagina, ver comentario
// no schema de AnpPrecoReferencia) o preco medio de revenda da ANP pra cada
// semana (domingo-a-sabado) que toca o mes informado. Best-effort: uma
// semana ainda nao publicada (ex. mes corrente) so conta como
// "indisponivel", nao trava as demais. Pula semana que ja tem registro —
// nunca refaz um fetch externo desnecessario. Sem valor de retorno (usado
// direto como `<form action={...}>`, sem useActionState) — o resultado
// aparece na proxima renderizacao via revalidatePath, os cards e o aviso de
// semanas faltantes ja recalculam a partir do banco.
export async function syncAnpPrices(mes: string): Promise<void> {
  await requireRole("ADMIN", "GESTOR");

  const monthStart = new Date(`${mes}-01T00:00:00`);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

  const weekStarts: Date[] = [];
  let cursor = anpWeekRange(monthStart).start;
  while (cursor < monthEnd) {
    weekStarts.push(cursor);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
  }

  for (const weekStart of weekStarts) {
    const { start, end } = anpWeekRange(weekStart);
    const already = await prisma.anpPrecoReferencia.findFirst({ where: { semanaInicio: start } });
    if (already) continue;

    const rows = await fetchAnpWeek(start, end);
    if (!rows) continue; // semana ainda nao publicada — segue pras demais

    await prisma.anpPrecoReferencia.createMany({
      data: rows.map((r) => ({
        uf: r.uf,
        produto: r.produto,
        semanaInicio: start,
        semanaFim: end,
        precoMedioCents: r.precoMedioCents,
      })),
      skipDuplicates: true,
    });
  }

  revalidatePath("/combustivel");
}
