import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import ImportSpreadsheetForm from "@/components/ImportSpreadsheetForm";
import { importDrivers } from "../actions";

export default async function ImportarMotoristasPage() {
  await requireSession();

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Importar motoristas"
        subtitle="Baixe o modelo, preencha uma linha por motorista e envie a planilha para cadastrar vários de uma vez."
      />
      <div className={cardClass}>
        <ImportSpreadsheetForm
          action={importDrivers}
          templateHref="/api/motoristas/template"
          entityLabel="motorista(s)"
        />
      </div>
    </div>
  );
}
