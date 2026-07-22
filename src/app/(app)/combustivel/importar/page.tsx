import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import ImportSpreadsheetForm from "@/components/ImportSpreadsheetForm";
import { importFuelTransactions } from "../actions";

export default async function ImportarCombustivelPage() {
  await requireSession();

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Importar extrato de combustível"
        subtitle="Baixe o modelo, preencha uma linha por transação do cartão Ticket Log e envie a planilha."
      />
      <div className={cardClass}>
        <ImportSpreadsheetForm
          action={importFuelTransactions}
          templateHref="/api/combustivel/template"
          entityLabel="transação(ões)"
        />
      </div>
    </div>
  );
}
