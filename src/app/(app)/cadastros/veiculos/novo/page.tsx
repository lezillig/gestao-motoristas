import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import VehicleForm from "../VehicleForm";
import { createVehicle } from "../actions";

export default function NovoVeiculoPage() {
  return (
    <div className="max-w-lg">
      <PageHeader title="Novo veículo" />
      <div className={cardClass}>
        <VehicleForm action={createVehicle} />
      </div>
    </div>
  );
}
