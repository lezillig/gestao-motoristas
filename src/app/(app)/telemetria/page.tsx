import { format } from "date-fns";
import { AlertTriangle, Gauge, Satellite, Trophy } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, primaryButtonClass, secondaryButtonClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import { getActiveTelemetryProvider } from "@/lib/telemetry";
import { describeIturanConfig } from "@/lib/ituran/config";
import { findSpeedAlerts, isSpeeding, SPEED_LIMIT_KMH } from "@/lib/speedCompliance";
import { syncTelemetry, testarConexao } from "./actions";
import type { Prisma } from "@prisma/client";

const SORT_FIELDS = ["vehicle", "speedKmh", "recordedAt"] as const;
type SortField = (typeof SORT_FIELDS)[number];

export default async function TelemetriaPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string; ok?: string; erro?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { sort, dir, ok, erro } = await searchParams;
  const provider = getActiveTelemetryProvider();
  const ituran = describeIturanConfig();

  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "recordedAt";
  const sortDir = dir === "asc" ? "asc" : "desc";
  const orderBy: Prisma.TelemetryReadingOrderByWithRelationInput =
    sortField === "vehicle"
      ? { vehicle: { plate: sortDir } }
      : sortField === "speedKmh"
        ? { speedKmh: sortDir }
        : { recordedAt: sortDir };

  const [readings, usageLogs] = await Promise.all([
    prisma.telemetryReading.findMany({
      where: { companyId: session.companyId },
      include: { vehicle: true },
      orderBy,
      take: 100,
    }),
    prisma.vehicleUsageLog.findMany({
      where: { companyId: session.companyId },
      include: { driver: true },
    }),
  ]);

  function driverAt(vehicleId: string, at: Date) {
    return usageLogs.find(
      (l) =>
        l.vehicleId === vehicleId &&
        l.checkInAt <= at &&
        (!l.checkOutAt || l.checkOutAt >= at)
    )?.driver;
  }

  const alerts = findSpeedAlerts(readings);

  const leaderboard = new Map<string, { name: string; count: number }>();
  for (const reading of alerts) {
    const driver = driverAt(reading.vehicleId, reading.recordedAt);
    if (!driver) continue;
    const entry = leaderboard.get(driver.id) ?? { name: driver.name, count: 0 };
    entry.count += 1;
    leaderboard.set(driver.id, entry);
  }
  const ranking = [...leaderboard.values()].sort((a, b) => b.count - a.count);

  return (
    <div className="max-w-6xl">
      <PageHeader title="Telemetria" subtitle="Velocidade e comportamento de direção por veículo." />

      {ok && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {ok}
        </div>
      )}
      {erro && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      <div className={`${cardClass} mb-6 flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              provider.live ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            <Satellite className="h-4 w-4" />
          </div>
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
              Fornecedor ativo: {provider.name}
              <span
                className={`${badgeClass} ${
                  provider.live ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {provider.live ? "integração real" : "simulado"}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              {ituran.configured ? (
                <>
                  Posições lidas da API da Ituran em {ituran.baseUrl} (autenticação por{" "}
                  {ituran.authMode === "token" ? "token" : `login de ${ituran.username}`}), casadas com o
                  cadastro pela placa. O sincronismo é incremental e roda também por agendamento diário.
                </>
              ) : (
                <>
                  Sem credenciais da Ituran configuradas (ITURAN_BASE_URL + token ou usuário/senha) — as
                  leituras são simuladas por um adapter que segue a mesma interface do fornecedor real,
                  então ligar a Ituran não muda o resto do produto.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={testarConexao}>
            <button type="submit" className={secondaryButtonClass}>
              Testar conexão
            </button>
          </form>
          <form action={syncTelemetry}>
            <button type="submit" className={primaryButtonClass}>
              {provider.live ? "Sincronizar agora" : "Gerar leituras simuladas"}
            </button>
          </form>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className={cardClass}>
          <div
            className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
              alerts.length > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{alerts.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Leituras com excesso de velocidade (&gt;{SPEED_LIMIT_KMH} km/h, últimas {readings.length} leituras)
          </p>
        </div>
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Trophy className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{ranking[0]?.name ?? "—"}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {ranking[0] ? `${ranking[0].count} excesso(s) de velocidade registrados` : "Nenhum excesso atribuído a um motorista ainda"}
          </p>
        </div>
      </div>

      {ranking.length > 0 && (
        <div className={`${cardClass} mb-6`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Ranking de excessos por motorista</h2>
          <ul className="flex flex-col gap-2">
            {ranking.map((r) => (
              <li key={r.name} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{r.name}</span>
                <span className={`${badgeClass} bg-red-100 text-red-700`}>{r.count} excesso(s)</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <SortableTh label="Veículo" field="vehicle" basePath="/telemetria" currentParams={{}} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Velocidade" field="speedKmh" basePath="/telemetria" currentParams={{}} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">Local</th>
                <SortableTh label="Registrado em" field="recordedAt" basePath="/telemetria" currentParams={{}} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {readings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma leitura ainda. Clique em{" "}
                    {provider.live ? "“Sincronizar agora”" : "“Gerar leituras simuladas”"} para
                    começar.
                  </td>
                </tr>
              )}
              {readings.map((r) => {
                const driver = driverAt(r.vehicleId, r.recordedAt);
                const speeding = isSpeeding(r);
                return (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.vehicle.plate}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <Gauge className={`h-3.5 w-3.5 ${speeding ? "text-red-600" : "text-slate-400"}`} />
                        <span className={speeding ? "font-semibold text-red-700" : "text-slate-700"}>
                          {r.speedKmh} km/h
                        </span>
                        {speeding && (
                          <span className={`${badgeClass} bg-red-100 text-red-700`}>excesso</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{driver?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {/* Endereço só vem de fornecedor real; sem ele, mostra a
                          coordenada crua, que é o que o mock produz. */}
                      {r.address ?? `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{format(r.recordedAt, "dd/MM/yyyy HH:mm")}</td>
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
