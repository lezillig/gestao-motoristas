import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import ClienteForm from "../ClienteForm";
import { createCliente } from "../actions";

export default function NovoClientePage() {
  return (
    <div className="max-w-lg">
      <PageHeader title="Novo cliente" />
      <div className={cardClass}>
        <ClienteForm action={createCliente} />
      </div>
    </div>
  );
}
