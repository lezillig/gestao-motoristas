import { format } from "date-fns";
import { AlertTriangle, Route } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";

export default async function ViagensPage() {
  const session = await requireRole("ADMIN", "GESTOR");

  const trips = await prisma.vehicleTrip.findMany({
    where: { companyId: session.companyId },
    include: { vehicle: true },
    orderBy: { startAt: "desc" },
    take: 100,
  });

  const semEscala = trips.filter((t) => !t.escalaId);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Viagens x escala"
        subtitle="Deslocamentos reais captados pela Ituran, cruzados com a escala planejada do veículo."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Route className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{trips.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Viagens registradas (últimas 100)</p>
        </div>
        <div className={cardClass}>
          <div
            className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
              semEscala.length > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{semEscala.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Viagens sem escala correspondente</p>
        </div>
      </div>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Veículo</th>
                <th className="px-4 py-3">Início</th>
                <th className="px-4 py-3">Fim</th>
                <th className="px-4 py-3">Distância</th>
                <th className="px-4 py-3">Vel. máx.</th>
                <th className="px-4 py-3">Motorista (Ituran)</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {trips.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma viagem registrada ainda.
                  </td>
                </tr>
              )}
              {trips.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{t.vehicle.plate}</td>
                  <td className="px-4 py-3 text-slate-600">{format(t.startAt, "dd/MM/yyyy HH:mm")}</td>
                  <td className="px-4 py-3 text-slate-600">{format(t.endAt, "HH:mm")}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {t.distanceKm != null ? `${t.distanceKm.toLocaleString("pt-BR")} km` : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{t.maxSpeedKmh != null ? `${t.maxSpeedKmh} km/h` : "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{t.driverNameRaw ?? "—"}</td>
                  <td className="px-4 py-3">
                    {!t.escalaId && <span className={`${badgeClass} bg-amber-100 text-amber-700`}>Sem escala</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
