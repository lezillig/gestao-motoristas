import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PontoForm from "../PontoForm";
import { createEntry } from "../actions";

export default async function NovoPontoPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; driverId?: string }>;
}) {
  const session = await requireSession();
  const { date, driverId } = await searchParams;

  const drivers = await prisma.driver.findMany({
    where: { companyId: session.companyId, active: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-lg">
      <PageHeader title="Novo registro de ponto" />
      <div className={cardClass}>
        <PontoForm
          action={createEntry}
          drivers={drivers}
          defaultValues={
            date || driverId
              ? { driverId: driverId ?? "", date: date ?? "", clockIn: "", clockOut: "", notes: "" }
              : undefined
          }
        />
      </div>
    </div>
  );
}
