"use server";

import { subDays } from "date-fns";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { matchVehicleAndDriver } from "@/lib/fuelMatching";
import { fetchFuelTransactionsSince } from "@/lib/sofit/client";
import type { Prisma } from "@prisma/client";

// Sem sincronizacao anterior (1a vez): busca so os ultimos 30 dias, nao o
// historico inteiro (~14 mil despesas de todo tipo na conta real, muito
// acima do teto de 60s do cron/acao) — o restante do historico fica so na
// planilha ja importada manualmente. Da em diante, cada sincronizacao
// retoma exatamente de onde a anterior parou (ver `since` abaixo).
const INITIAL_BACKFILL_DAYS = 30;

export async function syncSofitFuelCore(companyId: string): Promise<{ created: number; skipped: number }> {
  const [lastSync, vehicles, drivers, existingCodigos] = await Promise.all([
    prisma.fuelTransaction.findFirst({
      where: { companyId, fonte: "SOFIT" },
      orderBy: { dataHora: "desc" },
      select: { dataHora: true },
    }),
    prisma.vehicle.findMany({ where: { companyId }, select: { id: true, plate: true } }),
    prisma.driver.findMany({ where: { companyId }, select: { id: true, cpf: true, name: true } }),
    prisma.fuelTransaction.findMany({
      where: { companyId, codigoTransacao: { startsWith: "SOFIT-" } },
      select: { codigoTransacao: true },
    }),
  ]);

  const since = lastSync?.dataHora ?? subDays(new Date(), INITIAL_BACKFILL_DAYS);
  const vehicleByPlate = new Map(vehicles.map((v) => [v.plate, v.id]));
  const driverByCpf = new Map(drivers.map((d) => [d.cpf.replace(/\D/g, ""), d.id]));
  const driverByName = new Map(drivers.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const codigosVistos = new Set(existingCodigos.map((t) => t.codigoTransacao as string));

  const transactions = await fetchFuelTransactionsSince(since);

  let skipped = 0;
  const toCreate: Prisma.FuelTransactionCreateManyInput[] = [];
  for (const t of transactions) {
    const codigoTransacao = `SOFIT-${t.sofitTransactionId}`;
    if (codigosVistos.has(codigoTransacao)) continue;
    codigosVistos.add(codigoTransacao);
    // Sem placa ou sem os dois valores obrigatorios do modelo, a transacao
    // nao da pra registrar com integridade minima — pula em vez de
    // fabricar 0/"" (visibilidade financeira nao vale mais que dado errado).
    if (!t.plate || t.valorCents == null || t.volumeLitros == null) {
      skipped++;
      continue;
    }

    const { vehicleId, driverId } = matchVehicleAndDriver(
      t.plate,
      t.driverCpf || t.driverName || "",
      vehicleByPlate,
      driverByCpf,
      driverByName
    );

    toCreate.push({
      companyId,
      vehicleId: vehicleId ?? null,
      driverId: driverId ?? null,
      dataHora: t.dataHora,
      valorCents: t.valorCents,
      volumeLitros: t.volumeLitros,
      combustivel: t.combustivel,
      posto: t.posto,
      hodometro: t.hodometro,
      kmRodados: t.kmRodados,
      realConsumoKmL: t.realConsumoKmL,
      desvioConsumoPercentual: t.desvioConsumoPercentual,
      numeroAutorizacao: t.numeroAutorizacao,
      codigoTransacao,
      placaOriginal: t.plate,
      motoristaOriginal: t.driverName,
      modeloOriginal: null,
      fonte: "SOFIT",
    });
  }

  if (toCreate.length > 0) {
    await prisma.fuelTransaction.createMany({ data: toCreate });
  }

  return { created: toCreate.length, skipped };
}

// Botao manual "Sincronizar com Sofit" — sem args, mesmo padrao ja usado
// por syncAnpPrices nesta mesma pasta (form action simples, sem
// useActionState; resultado aparece via revalidatePath).
export async function syncSofitFuel(): Promise<void> {
  const session = await requireRole("ADMIN", "GESTOR");
  await syncSofitFuelCore(session.companyId);
  revalidatePath("/combustivel");
}
