import PageHeader from "@/components/ui/PageHeader";
import { requireSession } from "@/lib/auth";
import ImportResumoForm from "./ImportResumoForm";

export default async function ImportarResumoConsumoPage() {
  await requireSession();

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Importar resumo de consumo"
        subtitle="Envie o Relatório Resumido de Consumo exportado do sistema de gestão de frota (arquivo .xls, por veículo e contrato)."
      />
      <ImportResumoForm />
    </div>
  );
}
