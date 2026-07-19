import { format } from "date-fns";
import { AlertTriangle, Wrench } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { isMaintenanceDue, kmSinceLastMaintenance, MAINTENANCE_INTERVAL_KM } from "@/lib/maintenance";
import { closeUsageLog, registerMaintenance } from "./actions";

export default async function UtilizacaoPage() {
  const session = await requireSession();

  const [logs, vehicles, escalas] = await Promise.all([
    prisma.vehicleUsageLog.findMany({
      where: { companyId: session.companyId },
      include: { driver: true, vehicle: true },
      orderBy: { checkInAt: "desc" },
      take: 50,
    }),
    prisma.vehicle.findMany({ where: { companyId: session.companyId } }),
    prisma.escala.findMany({ where: { companyId: session.companyId } }),
  ]);

  const escalaKeys = new Set(
    escalas.map((e) => `${e.driverId}_${e.vehicleId}_${format(e.date, "yyyy-MM-dd")}`)
  );
  const hasMatchingEscala = (driverId: string, vehicleId: string, date: Date) =>
    escalaKeys.has(`${driverId}_${vehicleId}_${format(date, "yyyy-MM-dd")}`);

  const divergentLogs = logs.filter(
    (l) => !hasMatchingEscala(l.driverId, l.vehicleId, l.checkInAt)
  );
  const openLogs = logs.filter((l) => !l.checkOutAt);
  const vehiclesDue = vehicles.filter(isMaintenanceDue);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Utilização de veículos"
        subtitle="Uso real do veículo por motorista, cruzado com a escala planejada."
        actionHref="/utilizacao/novo"
        actionLabel="Novo check-in"
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={cardClass}>
          <div
            className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
              vehiclesDue.length > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            <Wrench className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{vehiclesDue.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Veículos com manutenção pendente (&gt;{MAINTENANCE_INTERVAL_KM.toLocaleString("pt-BR")} km)
          </p>
        </div>
        <div className={cardClass}>
          <div
            className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
              divergentLogs.length > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{divergentLogs.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Check-ins sem escala correspondente</p>
        </div>
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{openLogs.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Veículos em uso agora (check-in aberto)</p>
        </div>
      </div>

      {vehiclesDue.length > 0 && (
        <div className={`${cardClass} mb-6`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Manutenção pendente</h2>
          <ul className="flex flex-col gap-2">
            {vehiclesDue.map((v) => {
              const action = registerMaintenance.bind(null, v.id);
              return (
                <li key={v.id} className="flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm">
                  <span className="text-red-800">
                    <span className="font-mono font-medium">{v.plate}</span> — {kmSinceLastMaintenance(v).toLocaleString("pt-BR")} km desde a última manutenção
                  </span>
                  <form action={action}>
                    <button type="submit" className={secondaryButtonClass}>
                      Registrar manutenção
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">Veículo</th>
                <th className="px-4 py-3">Check-in</th>
                <th className="px-4 py-3">Km inicial</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Nenhum check-in registrado ainda.
                  </td>
                </tr>
              )}
              {logs.map((l) => {
                const divergente = !hasMatchingEscala(l.driverId, l.vehicleId, l.checkInAt);
                const closeAction = closeUsageLog.bind(null, l.id);
                return (
                  <tr key={l.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{l.driver.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{l.vehicle.plate}</td>
                    <td className="px-4 py-3 text-slate-600">{format(l.checkInAt, "dd/MM/yyyy HH:mm")}</td>
                    <td className="px-4 py-3 text-slate-600">{l.kmInicial.toLocaleString("pt-BR")} km</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {l.checkOutAt ? (
                          <span className={`${badgeClass} bg-slate-100 text-slate-600`}>
                            Encerrado · {((l.kmFinal ?? 0) - l.kmInicial).toLocaleString("pt-BR")} km rodados
                          </span>
                        ) : (
                          <span className={`${badgeClass} bg-blue-100 text-blue-700`}>Em aberto</span>
                        )}
                        {divergente && (
                          <span className={`${badgeClass} bg-amber-100 text-amber-700`}>Sem escala</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!l.checkOutAt && (
                        <form action={closeAction} className="flex items-center justify-end gap-2">
                          <input
                            type="number"
                            name="kmFinal"
                            required
                            min={l.kmInicial}
                            placeholder="Km final"
                            className={`${inputClass} w-28 py-1.5 text-xs`}
                          />
                          <button type="submit" className={`${primaryButtonClass} py-1.5 text-xs`}>
                            Encerrar
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
