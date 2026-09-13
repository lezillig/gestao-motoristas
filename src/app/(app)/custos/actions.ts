"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.number().int().min(0).max(300).nullable();

// Percentual de encargos sobre a folha, por empresa — so afeta /custos (ver
// comentario em Company.encargosPercentual no schema). Nulo = limpar.
export async function salvarEncargosPercentual(percentual: number | null): Promise<{ ok: boolean; message: string }> {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = schema.safeParse(percentual);
  if (!parsed.success) return { ok: false, message: "Informe um percentual inteiro entre 0 e 300." };
  await prisma.company.update({ where: { id: session.companyId }, data: { encargosPercentual: parsed.data } });
  revalidatePath("/custos");
  return { ok: true, message: parsed.data == null ? "Encargos removidos." : `Encargos de ${parsed.data}% salvos.` };
}
