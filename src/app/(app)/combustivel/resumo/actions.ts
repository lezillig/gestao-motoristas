"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isConsumoResumoHtml, parsePeriodo, parseConsumoResumoRows } from "@/lib/consumoResumo";

export type ImportResumoState = {
  error?: string;
  result?: { created: number; duplicated: number; periodo: string };
};

// Diferente de importDrivers/importVehicles/importFuelTransactions: o
// arquivo aqui e o "Relatorio Resumido de Consumo" (HTML disfarçado de
// .xls, ver src/lib/consumoResumo.ts) exatamente como o sistema de frota
// do usuario exporta — nao ha planilha-modelo nossa pra preencher. Um
// unico createMany (skipDuplicates) evita duplicar se o mesmo arquivo (ou
// um periodo ja importado) for reenviado.
export async function importConsumptionSummary(
  _prevState: ImportResumoState,
  formData: FormData
): Promise<ImportResumoState> {
  const session = await requireRole("ADMIN", "GESTOR");

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { error: "Selecione o arquivo do relatório." };
  }

  const html = await arquivo.text();
  if (!isConsumoResumoHtml(html)) {
    return { error: "Arquivo não reconhecido como Relatório Resumido de Consumo." };
  }
  const periodo = parsePeriodo(html);
  if (!periodo) {
    return { error: "Não foi possível identificar o período do relatório." };
  }
  const rows = parseConsumoResumoRows(html);
  if (rows.length === 0) {
    return { error: "Nenhuma linha de veículo encontrada no relatório." };
  }

  const vehicles = await prisma.vehicle.findMany({
    where: { companyId: session.companyId },
    select: { id: true, plate: true },
  });
  const vehicleByPlate = new Map(vehicles.map((v) => [v.plate, v.id]));

  const data = rows.map((r) => ({
    companyId: session.companyId,
    vehicleId: vehicleByPlate.get(r.placa) ?? null,
    placaOriginal: r.placa,
    contrato: r.contrato,
    tipoCombustivel: r.tipoCombustivel,
    ultimoKmOuHora: r.ultimoKmOuHora,
    periodoInicio: periodo.inicio,
    periodoFim: periodo.fim,
    kmRodados: r.kmRodados,
    horasTrabalhadas: r.horasTrabalhadas,
    litros: r.litros,
    valorMedioLitroCents: r.valorMedioLitroCents,
    kmPorLitro: r.kmPorLitro,
    litrosPorHora: r.litrosPorHora,
    totalCents: r.totalCents,
  }));

  const before = await prisma.fuelConsumptionSummary.count({ where: { companyId: session.companyId } });
  await prisma.fuelConsumptionSummary.createMany({ data, skipDuplicates: true });
  const after = await prisma.fuelConsumptionSummary.count({ where: { companyId: session.companyId } });
  const created = after - before;

  revalidatePath("/combustivel/resumo");
  return {
    result: {
      created,
      duplicated: rows.length - created,
      periodo: `${periodo.inicio.toLocaleDateString("pt-BR")} a ${periodo.fim.toLocaleDateString("pt-BR")}`,
    },
  };
}
