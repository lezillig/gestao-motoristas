import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DriverForm from "../DriverForm";
import { updateDriver } from "../actions";

export default async function EditarMotoristaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const [driver, sindicatos] = await Promise.all([
    prisma.driver.findUnique({ where: { id, companyId: session.companyId } }),
    prisma.sindicato.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { nome: "asc" },
    }),
  ]);
  if (!driver) notFound();

  const action = updateDriver.bind(null, id);

  return (
    <div className="max-w-lg">
      <PageHeader title={`Editar ${driver.name}`} />
      <div className={cardClass}>
        <DriverForm action={action} sindicatos={sindicatos} defaultValues={driver} />
      </div>
    </div>
  );
}
