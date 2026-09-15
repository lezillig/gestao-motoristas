"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { fetchFuelCardStatuses } from "@/lib/ticketlog/client";
import { syncTicketLogCardStatusesCore } from "@/lib/sync/ticketlogCards";
import { exigirIntegracoesDaEmpresa } from "@/lib/integracoesEmpresa";

export type TicketLogSyncState = { error?: string; result?: { count: number } };

export async function syncTicketLogCardStatuses(_prevState: TicketLogSyncState): Promise<TicketLogSyncState> {
  const session = await requireRole("ADMIN", "GESTOR");
  await exigirIntegracoesDaEmpresa(session.companyId);

  try {
    const statuses = await fetchFuelCardStatuses();
    const result = await syncTicketLogCardStatusesCore(session.companyId, statuses);
    revalidatePath("/combustivel/cartoes");
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao sincronizar com a Ticket Log." };
  }
}
