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
// de onde a anterior parou (ver `since` abaixo).
const INITIAL_BACKFILL_SINCE = new Date("2026-01-01T00:00:00.000Z");

const LOTE_LEITURA = 1000;

export type SofitFuelSyncResult = {
  created: number;
  skipped: number;
  hasMore: boolean;
  // Cursor pra continuar exatamente de onde parou quando hasMore: o mesmo
  // `since` desta chamada e a proxima pagina a buscar. Sem isso, a chamada
  // seguinte recalculava `since` e recomecava da pagina 1 — se o lote nao
  // coubesse no orcamento, o cron se reencadeava sem nunca avancar.
  since: Date;
  nextPage: number;
};

export async function syncSofitFuelCore(
  companyId: string,
  deadline?: number,
  sinceOverride?: Date,
  startPage = 1
): Promise<SofitFuelSyncResult> {
  const [lastSync, vehicles, drivers] = await Promise.all([
    prisma.fuelTransaction.findFirst({
      where: { companyId, fonte: "SOFIT" },
      orderBy: { dataHora: "desc" },
      select: { dataHora: true },
    }),
    prisma.vehicle.findMany({ where: { companyId }, select: { id: true, plate: true } }),
    prisma.driver.findMany({ where: { companyId }, select: { id: true, cpf: true, name: true } }),
  ]);

  // sinceOverride: backfill manual de uma lacuna especifica (ver
  // Integrações) ou continuacao encadeada do cron — pode refazer um trecho ja
  // coberto; o dedupe por codigoTransacao abaixo garante que so o que
  // realmente falta vira INSERT.
  const since = sinceOverride ?? lastSync?.dataHora ?? INITIAL_BACKFILL_SINCE;
  const vehicleByPlate = new Map(vehicles.map((v) => [v.plate, v.id]));
  const driverByCpf = new Map(drivers.map((d) => [d.cpf.replace(/\D/g, ""), d.id]));
  const driverByName = new Map(drivers.map((d) => [d.name.trim().toLowerCase(), d.id]));

  const { transactions, hasMore, nextPage } = await fetchFuelTransactionsSince(since, deadline, startPage);

  // Dedupe so contra os codigos deste lote — antes carregava todos os
  // codigos SOFIT-* ja importados (cresce sem limite) a cada execucao.
  const codigosDoLote = [...new Set(transactions.map((t) => `SOFIT-${t.sofitTransactionId}`))];
  const codigosVistos = new Set<string>();
  for (let i = 0; i < codigosDoLote.length; i += LOTE_LEITURA) {
    const rows = await prisma.fuelTransaction.findMany({
      where: { codigoTransacao: { in: codigosDoLote.slice(i, i + LOTE_LEITURA) } },
      select: { codigoTransacao: true },
    });
    for (const r of rows) if (r.codigoTransacao) codigosVistos.add(r.codigoTransacao);
  }

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

  let created = 0;
  if (toCreate.length > 0) {
    // skipDuplicates: cron encadeado e botao manual rodando juntos podiam
    // inserir o mesmo codigoTransacao (unico) e derrubar o lote inteiro.
    const r = await prisma.fuelTransaction.createMany({ data: toCreate, skipDuplicates: true });
    created = r.count;
  }

  return { created, skipped, hasMore, since, nextPage };
}
