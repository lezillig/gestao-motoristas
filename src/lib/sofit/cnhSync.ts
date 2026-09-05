import { prisma } from "@/lib/prisma";
import { normalizeCpf } from "@/lib/cpf";
import { parseLocalDate } from "@/lib/date";
import { fetchEmployeesCnh } from "./client";

export type SofitCnhSyncResult = { updated: number; unmatched: number; hasMore: boolean };

// A Sofit e tratada como fonte de verdade pro vencimento de CNH (pedido
// explicito do usuario, 2026-09-05: sync diario, sempre sobrescrevendo) —
// MAS so quando ela tem o dado. Um funcionario sem habilitation_* na Sofit
// (comum: so 324 dos 623 tem isso preenchido la) nao apaga o que ja
// tinhamos aqui; cada campo (numero/categoria/vencimento) e atualizado
// independente, so quando a Sofit manda um valor real pra ele.
export async function syncSofitCnhCore(companyId: string, deadline?: number): Promise<SofitCnhSyncResult> {
  const [drivers, { employees, hasMore }] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId },
      select: { id: true, cpf: true, cnh: true, cnhCategory: true, cnhExpiration: true },
    }),
    fetchEmployeesCnh(deadline),
  ]);

  const driverByCpf = new Map(drivers.map((d) => [normalizeCpf(d.cpf), d]));

  let updated = 0;
  let unmatched = 0;
  for (const emp of employees) {
    if (!emp.habilitationNum && !emp.habilitationCategory && !emp.habilitationDueDate) continue;

    const driver = driverByCpf.get(emp.cpf);
    if (!driver) {
      unmatched++;
      continue;
    }

    const expiration = emp.habilitationDueDate ? parseLocalDate(emp.habilitationDueDate) : null;
    const data: { cnh?: string; cnhCategory?: string; cnhExpiration?: Date } = {};
    if (emp.habilitationNum && emp.habilitationNum !== driver.cnh) data.cnh = emp.habilitationNum;
    if (emp.habilitationCategory && emp.habilitationCategory !== driver.cnhCategory) data.cnhCategory = emp.habilitationCategory;
    if (expiration && expiration.getTime() !== driver.cnhExpiration?.getTime()) data.cnhExpiration = expiration;

    if (Object.keys(data).length === 0) continue;

    await prisma.driver.update({ where: { id: driver.id }, data });
    updated++;
  }

  return { updated, unmatched, hasMore };
}
