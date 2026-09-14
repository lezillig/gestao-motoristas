import PageHeader from "@/components/ui/PageHeader";
import { requireRole } from "@/lib/auth";
import { cardClass } from "@/lib/ui";
import ClienteForm from "../ClienteForm";
import { createCliente } from "../actions";

export default async function NovoClientePage() {
  await requireRole("ADMIN", "GESTOR");
  return (
    <div className="max-w-lg">
      <PageHeader title="Novo cliente" />
      <div className={cardClass}>
        <ClienteForm action={createCliente} />
      </div>
    </div>
  );
}
