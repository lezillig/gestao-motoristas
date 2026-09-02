"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchFuelCardStatuses } from "@/lib/ticketlog/client";
import type { Prisma } from "@prisma/client";

// Compartilhado entre o botao manual (useActionState abaixo) e o cron
// diario (src/app/api/cron/ticketlog-import/route.ts) — mesma logica de
// upsert nos dois lugares. `statuses` vem de fora pra nao repetir a chamada
// da API quando o cron sincroniza varias empresas de uma vez.
export async function syncTicketLogCardStatusesCore(
  companyId: string,
  statuses: Awaited<ReturnType<typeof fetchFuelCardStatuses>>
): Promise<{ count: number }> {
  const vehicles = await prisma.vehicle.findMany({ where: { companyId }, select: { id: true, plate: true } });
  const vehicleByPlate = new Map(vehicles.map((v) => [v.plate.trim().toUpperCase(), v.id]));

  // Upsert um por um (nao createMany) — e um snapshot que se atualiza no
  // lugar, nao um append-only como FuelTransaction; volume baixo (~370
  // cartoes), sem problema de performance em loop sequencial aqui.
  for (const s of statuses) {
    const vehicleId = s.plate ? (vehicleByPlate.get(s.plate) ?? null) : null;
    const data: Prisma.FuelCardStatusUncheckedCreateInput = {
      companyId,
      vehicleId,
      numeroCartao: s.numeroCartao,
      placaOriginal: s.plate ?? "",
      situacaoCartao: s.situacaoCartao,
      situacaoVeiculo: s.situacaoVeiculo,
      saldoCents: s.saldoCents,
      limiteCents: s.limiteCents,
      saldoLitros: s.saldoLitros,
      limiteLitros: s.limiteLitros,
      comprasPeriodoCents: s.comprasPeriodoCents,
      comprasPeriodoLitros: s.comprasPeriodoLitros,
      tipoCombustivelPadrao: s.tipoCombustivelPadrao,
      tipoFrota: s.tipoFrota,
      modeloVeiculo: s.modeloVeiculo,
      fabricanteVeiculo: s.fabricanteVeiculo,
      cidade: s.cidade,
      uf: s.uf,
      nomeResponsavel: s.nomeResponsavel,
      dataAtivacao: s.dataAtivacao,
    };
    await prisma.fuelCardStatus.upsert({
      where: { companyId_numeroCartao: { companyId, numeroCartao: s.numeroCartao } },
      create: data,
      update: data,
    });
  }

  return { count: statuses.length };
}

export type TicketLogSyncState = { error?: string; result?: { count: number } };

export async function syncTicketLogCardStatuses(_prevState: TicketLogSyncState): Promise<TicketLogSyncState> {
  const session = await requireRole("ADMIN", "GESTOR");

  try {
    const statuses = await fetchFuelCardStatuses();
    const result = await syncTicketLogCardStatusesCore(session.companyId, statuses);
    revalidatePath("/combustivel/cartoes");
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao sincronizar com a Ticket Log." };
  }
}
