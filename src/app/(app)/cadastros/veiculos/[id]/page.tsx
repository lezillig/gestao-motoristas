import { notFound } from "next/navigation";
import { Satellite } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass, secondaryButtonClass } from "@/lib/ui";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import VehicleForm from "../VehicleForm";
import { updateVehicle, desvincularRastreadorCobli } from "../actions";

export default async function EditarVeiculoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireRole("ADMIN", "GESTOR");
  const vehicle = await prisma.vehicle.findUnique({
    where: { id, companyId: session.companyId },
  });
  if (!vehicle) notFound();

  const action = updateVehicle.bind(null, id);
  const desvincular = desvincularRastreadorCobli.bind(null, id);

  return (
    <div className="max-w-lg">
      <PageHeader title={`Editar ${vehicle.plate}`} />
      <div className={cardClass}>
        <VehicleForm action={action} defaultValues={vehicle} />
      </div>

      {vehicle.cobliDeviceId && (
        <div className={`${cardClass} mt-6 flex flex-wrap items-center justify-between gap-3`}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Satellite className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">Rastreador Cobli vinculado</p>
              <p className="font-mono text-xs text-slate-500">{vehicle.cobliDeviceId}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                Desvincule só quando o equipamento sair deste veículo — a próxima sincronização
                vincula de novo pela placa.
              </p>
            </div>
          </div>
          <form action={desvincular}>
            <button type="submit" className={secondaryButtonClass}>
              Desvincular
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
