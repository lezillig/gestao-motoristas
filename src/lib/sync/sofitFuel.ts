// Nucleo da sincronizacao de combustivel Sofit, sem sessao — usado pela
// server action (combustivel/sofitActions.ts) e pelo cron. Fora de "use server"
// de proposito (todo export de la vira endpoint de Server Action).
import { prisma } from "@/lib/prisma";
import { matchVehicleAndDriver } from "@/lib/fuelMatching";
import { fetchFuelTransactionsSince } from "@/lib/sofit/client";
import type { Prisma } from "@prisma/client";

// Sem sincronizacao anterior (1a vez): comeca em 2026-01-01 (pedido
// explicito do usuario) em vez do historico inteiro da conta (desde 2021,
// ~14 mil despesas de todo tipo). Da em diante, cada sincronizacao retoma
// de onde a anterior parou (ver `since` abaixo) — como o fetch e limitado
// por orcamento de tempo (ver fetchFuelTransactionsSince), um backfill
// grande pode levar varias chamadas pra completar; isso e esperado e seguro
// (nunca reprocessa nem duplica, so demora mais de uma vez).
const INITIAL_BACKFILL_SINCE = new Date("2026-01-01T00:00:00.000Z");

export async function syncSofitFuelCore(
  companyId: string,
  deadline?: number,
  sinceOverride?: Date
): Promise<{ created: number; skipped: number; hasMore: boolean }> {
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

  // sinceOverride: backfill manual de uma lacuna especifica (ver
  // Integrações) — sempre mais antigo que o normal "desde a ultima
  // sincronizacao", entao refaz um trecho ja coberto tambem, mas o
  // dedupe por codigoTransacao acima (`codigosVistos`) ja garante que so
  // o que realmente falta vira INSERT novo.
  const since = sinceOverride ?? lastSync?.dataHora ?? INITIAL_BACKFILL_SINCE;
  const vehicleByPlate = new Map(vehicles.map((v) => [v.plate, v.id]));
  const driverByCpf = new Map(drivers.map((d) => [d.cpf.replace(/\D/g, ""), d.id]));
  const driverByName = new Map(drivers.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const codigosVistos = new Set(existingCodigos.map((t) => t.codigoTransacao as string));

  const { transactions, hasMore } = await fetchFuelTransactionsSince(since, deadline);

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

  return { created: toCreate.length, skipped, hasMore };
}
