import PageHeader from "@/components/ui/PageHeader";
import { requireRole } from "@/lib/auth";
import { cardClass } from "@/lib/ui";
import VehicleForm from "../VehicleForm";
import { createVehicle } from "../actions";

export default async function NovoVeiculoPage() {
  await requireRole("ADMIN", "GESTOR");
  return (
    <div className="max-w-lg">
      <PageHeader title="Novo veículo" />
      <div className={cardClass}>
        <VehicleForm action={createVehicle} />
      </div>
    </div>
  );
}
