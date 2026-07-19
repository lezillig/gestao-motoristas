import { notFound } from "next/navigation";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass, secondaryButtonClass } from "@/lib/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PontoForm from "../PontoForm";
import { updateEntry, deleteEntry } from "../actions";

export default async function EditarPontoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const [entry, drivers] = await Promise.all([
    prisma.timeClockEntry.findUnique({ where: { id, companyId: session.companyId } }),
    prisma.driver.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!entry) notFound();

  const action = updateEntry.bind(null, id);
  const removeAction = deleteEntry.bind(null, id);

  return (
    <div className="max-w-lg">
      <PageHeader title="Editar registro de ponto" />
      <div className={cardClass}>
        <PontoForm
          action={action}
          drivers={drivers}
          defaultValues={{
            driverId: entry.driverId,
            date: format(entry.date, "yyyy-MM-dd"),
            clockIn: entry.clockIn,
            clockOut: entry.clockOut,
            intervaloInicio: entry.intervaloInicio,
            intervaloFim: entry.intervaloFim,
            notes: entry.notes,
          }}
        />
        <form action={removeAction} className="mt-4 border-t border-slate-100 pt-4">
          <button type="submit" className={`${secondaryButtonClass} flex items-center gap-1.5 text-red-600 hover:bg-red-50`}>
            <Trash2 className="h-3.5 w-3.5" /> Remover registro
          </button>
        </form>
      </div>
    </div>
  );
}
