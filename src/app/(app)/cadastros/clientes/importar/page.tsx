import PageHeader from "@/components/ui/PageHeader";
import { requireRole } from "@/lib/auth";
import { cardClass } from "@/lib/ui";
import ClienteImportForm from "./ClienteImportForm";

export default async function ImportarClientesPage() {
  await requireRole("ADMIN", "GESTOR");
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Importar centro de custo"
        subtitle="Sincroniza direto da Unidade de alocação dos motoristas/funcionários já cadastrados, ou envie uma planilha (colunas CPF, Nome e Centro de custo - Atual) se precisar de um nome diferente."
      />
      <div className={cardClass}>
        <ClienteImportForm />
      </div>
    </div>
  );
}
