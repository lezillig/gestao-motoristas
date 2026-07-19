import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import VehicleForm from "../VehicleForm";
import { updateVehicle } from "../actions";

export default async function EditarVeiculoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const vehicle = await prisma.vehicle.findUnique({
    where: { id, companyId: session.companyId },
  });
  if (!vehicle) notFound();

  const action = updateVehicle.bind(null, id);

  return (
    <div className="max-w-lg">
      <PageHeader title={`Editar ${vehicle.plate}`} />
      <div className={cardClass}>
        <VehicleForm action={action} defaultValues={vehicle} />
      </div>
    </div>
  );
}
