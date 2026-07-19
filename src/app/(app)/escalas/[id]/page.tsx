import { notFound } from "next/navigation";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass, secondaryButtonClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import EscalaForm from "../EscalaForm";
import { updateEscala, deleteEscala } from "../actions";

export default async function EditarEscalaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const [escala, drivers, vehicles] = await Promise.all([
    prisma.escala.findUnique({ where: { id, companyId: session.companyId } }),
    prisma.driver.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.vehicle.findMany({
      where: { companyId: session.companyId, status: { not: "INATIVO" } },
      orderBy: { plate: "asc" },
    }),
  ]);
  if (!escala) notFound();

  const action = updateEscala.bind(null, id);
  const removeAction = deleteEscala.bind(null, id);

  return (
    <div className="max-w-lg">
      <PageHeader title="Editar escala" />
      <div className={cardClass}>
        <EscalaForm
          action={action}
          drivers={drivers}
          vehicles={vehicles}
          defaultValues={{
            driverId: escala.driverId,
            vehicleId: escala.vehicleId,
            date: format(escala.date, "yyyy-MM-dd"),
            startTime: escala.startTime,
            endTime: escala.endTime,
            notes: escala.notes,
          }}
        />
        <form action={removeAction} className="mt-4 border-t border-slate-100 pt-4">
          <button type="submit" className={`${secondaryButtonClass} flex items-center gap-1.5 text-red-600 hover:bg-red-50`}>
            <Trash2 className="h-3.5 w-3.5" /> Remover escala
          </button>
        </form>
      </div>
    </div>
  );
}
