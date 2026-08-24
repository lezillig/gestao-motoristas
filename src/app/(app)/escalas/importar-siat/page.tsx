import { redirect } from "next/navigation";
import { addDays, format, min as minDate } from "date-fns";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSiatAvailable } from "@/lib/siat/client";
import SiatSyncForm from "../SiatSyncForm";

export default async function ImportarSiatPage() {
  const session = await requireRole("ADMIN", "GESTOR");
  if (!isSiatAvailable()) redirect("/escalas");

  // Sugere continuar de onde a ultima sincronizacao parou, pra nao precisar
  // lembrar a data manualmente.
  const lastSynced = await prisma.escala.findFirst({
    where: { companyId: session.companyId, fonte: "SIAT" },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const today = new Date();
  // Nunca deixa a data inicial depois da final (ex.: ultima sincronizacao
  // ja cobriu ate hoje) — trava em hoje nesse caso.
  const defaultDateFrom = format(lastSynced ? minDate([addDays(lastSynced.date, 1), today]) : today, "yyyy-MM-dd");
  const defaultDateTo = format(today, "yyyy-MM-dd");

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Sincronizar com o SIAT"
        subtitle="O SIAT é a fonte oficial das escalas — essa sincronização cria/atualiza veículos, motoristas e escalas a partir de lá."
      />
      <div className={cardClass}>
        <SiatSyncForm defaultDateFrom={defaultDateFrom} defaultDateTo={defaultDateTo} />
      </div>
    </div>
  );
}
