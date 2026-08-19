"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { isOmieAvailable } from "@/lib/omie/client";
import { syncClientesOmie, syncTitulosOmie, type SyncResultado } from "@/lib/omie/sync";
import type { OmieTipoTitulo } from "@/lib/omie/types";

// Orçamento de tempo de um sync disparado na tela. A função tem teto de 60s
// (ver maxDuration na page); parar em 45s deixa margem pra gravar o
// OmieSyncLog e devolver o resultado — o sync é idempotente, então um
// resultado parcial é só "rode de novo pra continuar", nunca perda de dado.
const SYNC_TIME_BUDGET_MS = 45_000;

export type SyncActionResult = { error: string } | { resultado: SyncResultado };

const periodoSchema = z.object({
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inicial inválida"),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data final inválida"),
});

// Datas de <input type="date"> chegam como "AAAA-MM-DD". Convertidas para
// meio-dia LOCAL pelo mesmo motivo de parseDataOmie: `new Date("2026-07-01")`
// é meia-noite UTC, que no Brasil já é 30/06 — o filtro perderia o primeiro
// dia do período.
function parseDataLocal(iso: string, fimDoDia: boolean): Date {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia, fimDoDia ? 23 : 12, fimDoDia ? 59 : 0, 0, 0);
}

export async function sincronizarClientes(criarNovos: boolean): Promise<SyncActionResult> {
  const session = await requireRole("ADMIN", "GESTOR");
  if (!isOmieAvailable()) {
    return { error: "Integração com o Omie não configurada (OMIE_APP_KEY/OMIE_APP_SECRET)." };
  }

  const resultado = await syncClientesOmie(session.companyId, {
    criarNovos,
    origem: "MANUAL",
    executadoPorUserId: session.userId,
    deadline: Date.now() + SYNC_TIME_BUDGET_MS,
  });

  revalidatePath("/integracoes/omie");
  revalidatePath("/cadastros/clientes");
  return { resultado };
}

export async function sincronizarTitulos(
  tipo: OmieTipoTitulo,
  inicio: string,
  fim: string
): Promise<SyncActionResult> {
  const session = await requireRole("ADMIN", "GESTOR");
  if (!isOmieAvailable()) {
    return { error: "Integração com o Omie não configurada (OMIE_APP_KEY/OMIE_APP_SECRET)." };
  }

  const parsed = periodoSchema.safeParse({ inicio, fim });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Período inválido." };
  }

  const dataInicio = parseDataLocal(parsed.data.inicio, false);
  const dataFim = parseDataLocal(parsed.data.fim, true);
  if (dataFim < dataInicio) {
    return { error: "A data final é anterior à inicial." };
  }

  const resultado = await syncTitulosOmie(
    session.companyId,
    tipo,
    { inicio: dataInicio, fim: dataFim },
    {
      origem: "MANUAL",
      executadoPorUserId: session.userId,
      deadline: Date.now() + SYNC_TIME_BUDGET_MS,
    }
  );

  revalidatePath("/integracoes/omie");
  return { resultado };
}
