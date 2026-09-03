import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireRole } from "@/lib/auth";
import ImportSpreadsheetForm from "@/components/ImportSpreadsheetForm";
import TiqueTaqueDriverImportButton from "../TiqueTaqueDriverImportButton";
import PayrollImportForm from "../PayrollImportForm";
import { isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import { importDrivers } from "../actions";

export default async function ImportarMotoristasPage() {
  await requireRole("ADMIN", "GESTOR");

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

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Ou importe da folha de pagamento</h2>
        <div className={cardClass}>
          <PayrollImportForm />
          <p className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-400">
            Aceita a exportação &quot;Empregados em Excel&quot; (Apenas Ativos) direto da folha de pagamento — não
            precisa reformatar no modelo acima. Se o arquivo .xls der erro de leitura, abra no Excel, salve
            como .xlsx e envie de novo.
          </p>
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
