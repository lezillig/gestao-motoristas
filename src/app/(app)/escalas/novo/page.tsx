import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import EscalaForm from "../EscalaForm";
import { createEscala } from "../actions";

export default async function NovaEscalaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; driverId?: string }>;
}) {
  const session = await requireSession();
  const { date, driverId } = await searchParams;

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
      <PageHeader title="Nova escala" />
      <div className={cardClass}>
        <EscalaForm
          action={createEscala}
          drivers={drivers}
          vehicles={vehicles}
          defaultValues={
            date || driverId
              ? {
                  driverId: driverId ?? "",
                  vehicleId: "",
                  date: date ?? "",
                  startTime: "",
                  endTime: "",
                  notes: "",
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
