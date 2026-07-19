import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SindicatoForm from "../SindicatoForm";
import { updateSindicato } from "../actions";

export default async function EditarSindicatoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const sindicato = await prisma.sindicato.findUnique({
    where: { id, companyId: session.companyId },
  });
  if (!sindicato) notFound();

  const action = updateSindicato.bind(null, id);

  return (
    <div className="max-w-lg">
      <PageHeader title={`Editar ${sindicato.nome}`} />
      <div className={cardClass}>
        <SindicatoForm action={action} defaultValues={sindicato} />
      </div>
    </div>
  );
}
