import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireRole } from "@/lib/auth";
import ImportSpreadsheetForm from "@/components/ImportSpreadsheetForm";
import { importVehicles } from "../actions";

export default async function ImportarVeiculosPage() {
  await requireRole("ADMIN", "GESTOR");

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Importar veículos"
        subtitle="Baixe o modelo, preencha uma linha por veículo e envie a planilha para cadastrar vários de uma vez."
      />
      <div className={cardClass}>
        <ImportSpreadsheetForm
          action={importVehicles}
          templateHref="/api/veiculos/template"
          entityLabel="veículo(s)"
        />
      </div>
    </div>
  );
}
