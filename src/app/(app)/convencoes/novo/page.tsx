import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ConvencaoForm from "../ConvencaoForm";
import { createConvencao } from "../actions";

export default async function NovaConvencaoPage() {
  const session = await requireSession();
  const sindicatos = await prisma.sindicato.findMany({
    where: { companyId: session.companyId, active: true },
    orderBy: { nome: "asc" },
  });

  return (
    <div className="max-w-lg">
      <PageHeader title="Nova convenção coletiva" />
      <div className={cardClass}>
        <ConvencaoForm action={createConvencao} sindicatos={sindicatos} />
      </div>
    </div>
  );
}
