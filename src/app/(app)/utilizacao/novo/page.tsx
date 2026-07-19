import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import UsageForm from "../UsageForm";
import { createUsageLog } from "../actions";

export default async function NovaUtilizacaoPage() {
  const session = await requireSession();
  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.vehicle.findMany({
      where: { companyId: session.companyId, status: { not: "INATIVO" } },
      orderBy: { plate: "asc" },
    }),
  ]);

  return (
    <div className="max-w-lg">
      <PageHeader title="Check-in de veículo" />
      <div className={cardClass}>
        <UsageForm action={createUsageLog} drivers={drivers} vehicles={vehicles} />
      </div>
    </div>
  );
}
