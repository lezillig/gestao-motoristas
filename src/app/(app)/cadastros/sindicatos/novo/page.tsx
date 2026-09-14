import PageHeader from "@/components/ui/PageHeader";
import { requireRole } from "@/lib/auth";
import { cardClass } from "@/lib/ui";
import SindicatoForm from "../SindicatoForm";
import { createSindicato } from "../actions";

export default async function NovoSindicatoPage() {
  await requireRole("ADMIN", "GESTOR");
  return (
    <div className="max-w-lg">
      <PageHeader title="Novo sindicato" />
      <div className={cardClass}>
        <SindicatoForm action={createSindicato} />
      </div>
    </div>
  );
}
