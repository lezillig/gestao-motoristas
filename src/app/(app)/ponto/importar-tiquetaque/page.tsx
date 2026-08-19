import { redirect } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireRole } from "@/lib/auth";
import { isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import TiqueTaqueImportForm from "../TiqueTaqueImportForm";
import TiqueTaqueCsvImportForm from "../TiqueTaqueCsvImportForm";

export default async function ImportarTiqueTaquePage() {
  await requireRole("ADMIN", "GESTOR");
  if (!isTiqueTaqueAvailable()) redirect("/ponto");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <PageHeader
          title="Importar do TiqueTaque"
          subtitle="Busca as batidas de ponto do período por CPF e cria os registros que ainda não existem — nunca sobrescreve um registro já lançado."
        />
        <div className={cardClass}>
          <TiqueTaqueImportForm />
        </div>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Planilha oficial (exportação em massa)</h2>
        <p className="mb-3 text-sm text-slate-500">
          Mais precisa que a importação direta acima — usa o pareamento entrada/saída que o próprio TiqueTaque já
          decide na planilha que você exporta do painel dele, em vez de reconstruir a partir das batidas avulsas.
          Pode corrigir um registro importado pela API, mas nunca sobrescreve um lançamento manual.
        </p>
        <div className={cardClass}>
          <TiqueTaqueCsvImportForm />
        </div>
      </div>
    </div>
  );
}
