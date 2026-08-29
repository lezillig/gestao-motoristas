import { format } from "date-fns";
import { AlertTriangle, Route } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import { parseLocalDate } from "@/lib/date";
import type { Prisma } from "@prisma/client";

const SORT_FIELDS = ["vehicle", "startAt", "distanceKm", "maxSpeedKmh"] as const;
type SortField = (typeof SORT_FIELDS)[number];

export default async function ViagensPage({
  searchParams,
}: {
  searchParams: Promise<{
    sort?: string;
    dir?: string;
    vehicleId?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
  }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { sort, dir, vehicleId, dateFrom, dateTo, status } = await searchParams;

  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "startAt";
  const sortDir = dir === "asc" ? "asc" : "desc";
  const orderBy: Prisma.VehicleTripOrderByWithRelationInput =
    sortField === "vehicle"
      ? { vehicle: { plate: sortDir } }
      : sortField === "distanceKm"
        ? { distanceKm: sortDir }
        : sortField === "maxSpeedKmh"
          ? { maxSpeedKmh: sortDir }
          : { startAt: sortDir };

  const where: Prisma.VehicleTripWhereInput = { companyId: session.companyId };
  if (vehicleId) where.vehicleId = vehicleId;
  if (status === "sem_escala") where.escalaId = null;
  if (dateFrom || dateTo) {
    where.startAt = {
      ...(dateFrom ? { gte: parseLocalDate(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(parseLocalDate(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1) } : {}),
    };
  }
  const filtered = Boolean(vehicleId || dateFrom || dateTo || status);
  const sortLinkParams = { vehicleId, dateFrom, dateTo, status };

  const [trips, vehicles] = await Promise.all([
    prisma.vehicleTrip.findMany({
      where,
      include: { vehicle: true, escala: { include: { driver: true } } },
      orderBy,
      take: filtered ? 2000 : 100,
    }),
    prisma.vehicle.findMany({
      where: { companyId: session.companyId, status: { not: "INATIVO" } },
      select: { id: true, plate: true },
      orderBy: { plate: "asc" },
    }),
  ]);

  const semEscala = trips.filter((t) => !t.escalaId);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Viagens x escala"
        subtitle="Deslocamentos reais captados pela Ituran, cruzados com a escala planejada do veículo."
      />

      <form className={`${cardClass} mb-6 flex flex-wrap items-end gap-3`} method="get">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Veículo</label>
          <select name="vehicleId" defaultValue={vehicleId ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">De</label>
          <input type="date" name="dateFrom" defaultValue={dateFrom} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Até</label>
          <input type="date" name="dateTo" defaultValue={dateTo} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
          <select name="status" defaultValue={status ?? ""} className={inputClass}>
            <option value="">Todos</option>
            <option value="sem_escala">Sem escala</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
        {filtered && (
          <a href="/telemetria/viagens" className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline">
            Limpar filtro
          </a>
        )}
      </form>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Route className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{trips.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {filtered ? "Viagens no filtro" : "Viagens registradas (últimas 100)"}
          </p>
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
                <SortableTh label="Veículo" field="vehicle" basePath="/telemetria/viagens" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Início" field="startAt" basePath="/telemetria/viagens" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <th className="px-4 py-3">Fim</th>
                <SortableTh label="Distância" field="distanceKm" basePath="/telemetria/viagens" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Vel. máx." field="maxSpeedKmh" basePath="/telemetria/viagens" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {trips.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {filtered ? "Nenhuma viagem encontrada com os filtros aplicados." : "Nenhuma viagem registrada ainda."}
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
                  <td className="px-4 py-3 text-slate-600">
                    {t.escala ? (
                      t.escala.driver.name
                    ) : t.driverNameRaw ? (
                      <span title="Sem escala correspondente — motorista informado pela Ituran, não confirmado no SIAT.">
                        {t.driverNameRaw} <span className="text-[10px] italic text-slate-400">(Ituran)</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
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
