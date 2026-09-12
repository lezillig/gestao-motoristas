"use server";

import { requireRole } from "@/lib/auth";
import { isLwAvailable } from "@/lib/lw/client";
import { conferirCadastrosLw, type LwCadastroConferencia } from "@/lib/lw/sync";

export async function conferirCadastrosLwAction(): Promise<{ result?: LwCadastroConferencia; error?: string }> {
  const session = await requireRole("ADMIN", "GESTOR");
  if (!isLwAvailable()) return { error: "LW não configurada (LW_API_LOGIN/LW_API_SENHA)." };
  try {
    return { result: await conferirCadastrosLw(session.companyId) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao consultar a LW." };
  }
}
