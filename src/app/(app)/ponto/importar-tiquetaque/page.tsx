import { redirect } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import { isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import TiqueTaqueImportForm from "../TiqueTaqueImportForm";

export default async function ImportarTiqueTaquePage() {
  await requireSession();
  if (!isTiqueTaqueAvailable()) redirect("/ponto");

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Importar do TiqueTaque"
        subtitle="Busca as batidas de ponto do período por CPF e cria os registros que ainda não existem — nunca sobrescreve um registro já lançado."
      />
      <div className={cardClass}>
        <TiqueTaqueImportForm />
      </div>
    </div>
  );
}
