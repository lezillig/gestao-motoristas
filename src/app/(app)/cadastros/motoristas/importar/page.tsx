import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import ImportSpreadsheetForm from "@/components/ImportSpreadsheetForm";
import TiqueTaqueDriverImportButton from "../TiqueTaqueDriverImportButton";
import { isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import { importDrivers } from "../actions";

export default async function ImportarMotoristasPage() {
  await requireSession();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
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

      {isTiqueTaqueAvailable() && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Ou importe direto do TiqueTaque</h2>
          <div className={cardClass}>
            <TiqueTaqueDriverImportButton />
          </div>
        </div>
      )}
    </div>
  );
}
