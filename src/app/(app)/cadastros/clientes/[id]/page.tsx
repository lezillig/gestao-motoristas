import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ClienteForm from "../ClienteForm";
import { updateCliente } from "../actions";

export default async function EditarClientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireRole("ADMIN", "GESTOR");
  const cliente = await prisma.cliente.findUnique({
    where: { id, companyId: session.companyId },
  });
  if (!cliente) notFound();

  const action = updateCliente.bind(null, id);

  return (
    <div className="max-w-lg">
      <PageHeader title={`Editar ${cliente.nome}`} />
      <div className={cardClass}>
        <ClienteForm action={action} defaultValues={cliente} />
      </div>
    </div>
  );
}
