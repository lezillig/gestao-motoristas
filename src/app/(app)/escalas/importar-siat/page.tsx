import { redirect } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireRole } from "@/lib/auth";
import { isSiatAvailable } from "@/lib/siat/client";
import SiatSyncForm from "../SiatSyncForm";

export default async function ImportarSiatPage() {
  await requireRole("ADMIN", "GESTOR");
  if (!isSiatAvailable()) redirect("/escalas");

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Sincronizar com o SIAT"
        subtitle="O SIAT é a fonte oficial das escalas — essa sincronização cria/atualiza veículos, motoristas e escalas a partir de lá."
      />
      <div className={cardClass}>
        <SiatSyncForm />
      </div>
    </div>
  );
}
