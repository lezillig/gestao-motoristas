import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import ClienteImportForm from "./ClienteImportForm";

export default function ImportarClientesPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Importar centro de custo"
        subtitle="Planilha com colunas CPF, Nome e Centro de custo - Atual — vincula cada motorista/funcionário já cadastrado ao cliente correspondente."
      />
      <div className={cardClass}>
        <ClienteImportForm />
      </div>
    </div>
  );
}
