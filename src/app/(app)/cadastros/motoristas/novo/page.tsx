import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DriverForm from "../DriverForm";
import { createDriver } from "../actions";

export default async function NovoMotoristaPage() {
  const session = await requireRole("ADMIN", "GESTOR");
  const [sindicatos, clientes] = await Promise.all([
    prisma.sindicato.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { nome: "asc" },
    }),
    prisma.cliente.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  return (
    <div className="max-w-lg">
      <PageHeader title="Novo motorista" />
      <div className={cardClass}>
        <DriverForm action={createDriver} sindicatos={sindicatos} clientes={clientes} />
      </div>
    </div>
  );
}
