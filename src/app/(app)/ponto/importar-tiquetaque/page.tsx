import { redirect } from "next/navigation";
import { addDays, format, min as minDate } from "date-fns";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import TiqueTaqueImportForm from "../TiqueTaqueImportForm";
import TiqueTaqueCsvImportForm from "../TiqueTaqueCsvImportForm";

export default async function ImportarTiqueTaquePage() {
  const session = await requireRole("ADMIN", "GESTOR");
  if (!isTiqueTaqueAvailable()) redirect("/ponto");

  // Sugere continuar de onde a ultima importacao parou, pra nao precisar
  // lembrar a data manualmente — so considera fonte automatica (API ou
  // planilha), lancamento manual nao conta como "importado".
  const lastImported = await prisma.timeClockEntry.findFirst({
    where: { companyId: session.companyId, fonte: { in: ["TIQUETAQUE", "TIQUETAQUE_CSV"] } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const today = new Date();
  // Nunca deixa a data inicial depois da final (ex.: ultima importacao ja
  // cobriu ate hoje) — trava em hoje nesse caso.
  const defaultStartDate = format(lastImported ? minDate([addDays(lastImported.date, 1), today]) : today, "yyyy-MM-dd");
  const defaultEndDate = format(today, "yyyy-MM-dd");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <PageHeader
          title="Importar do TiqueTaque"
          subtitle="Busca as batidas de ponto do período por CPF e cria os registros que ainda não existem — nunca sobrescreve um registro já lançado."
        />
        <div className={cardClass}>
          <TiqueTaqueImportForm defaultStartDate={defaultStartDate} defaultEndDate={defaultEndDate} />
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
