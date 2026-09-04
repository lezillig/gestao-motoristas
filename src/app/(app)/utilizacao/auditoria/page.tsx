import Link from "next/link";
import { addDays, format } from "date-fns";
import { AlertTriangle, ArrowLeft, CheckCircle2, SearchX } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass, primaryButtonClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import ComboboxFilter from "@/components/ui/ComboboxFilter";
import { parseLocalDate } from "@/lib/date";
import { toMinutes } from "@/lib/time";
import { workedMinutes } from "@/lib/pontoCompliance";
import { pontoWindow } from "@/lib/viagemPontoAudit";

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Mesmo nome, escrito em ordem diferente ou com apelido no meio, ainda deve
// "bater" — compara por conjunto de palavras em vez de string exata.
function namesLikelyMatch(a: string, b: string): boolean {
  const wa = new Set(normalizeName(a).split(/\s+/).filter((w) => w.length > 2));
  const wb = new Set(normalizeName(b).split(/\s+/).filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return true; // nome curto/vazio demais pra comparar, nao acusa
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits++;
  return hits >= Math.min(wa.size, wb.size, 2);
}

function windowsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date, toleranceMinutes: number): boolean {
  const tol = toleranceMinutes * 60 * 1000;
  return aStart.getTime() - tol < bEnd.getTime() && bStart.getTime() - tol < aEnd.getTime();
}

// O sync do Ituran (cron /api/cron/ituran-import) roda 1x por dia de
// madrugada e so busca o dia ANTERIOR — confirmado real (2026-09-03): uma
// viagem de hoje ja aparecia no proprio site da Ituran, mas o endpoint
// /v2/trips deles devolvia 0 viagens pra frota inteira nesse mesmo dia (a
// Ituran so fecha/consolida a viagem depois que ela termina). Entao "sem
// viagem" pra hoje ou pra ontem a noite e esperado, nao falta de dado real.
function maybeNotYetSynced(dataISO: string | undefined): boolean {
  if (!dataISO) return false;
  const shifted = new Date(Date.now() - 3 * 60 * 60 * 1000); // UTC-3 fixo, ver src/lib/date.ts
  const todayISO = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
  const yesterday = new Date(shifted.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayISO = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`;
  return dataISO === todayISO || dataISO === yesterdayISO;
}

const LEAVE_LABELS: Record<string, string> = {
  folga: "Folga",
  atestado: "Atestado",
  ferias: "Férias",
  abono: "Abono",
};

export default async function AuditoriaDiaPage({
  searchParams,
}: {
  searchParams: Promise<{ driverId?: string; vehicleId?: string; data?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { driverId, vehicleId, data } = await searchParams;

  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.vehicle.findMany({
      where: { companyId: session.companyId },
      orderBy: { plate: "asc" },
      select: { id: true, plate: true },
    }),
  ]);

  const dayStart = data ? parseLocalDate(data) : null;
  const dateValid = Boolean(dayStart && !Number.isNaN(dayStart.getTime()));
  const dayEnd = dateValid ? addDays(dayStart!, 1) : null;
  const ready = Boolean(driverId && dateValid);

  const driver = ready ? drivers.find((d) => d.id === driverId) : undefined;

  const alerts: { level: "info" | "warning"; text: string }[] = [];
  let escalas: Awaited<ReturnType<typeof prisma.escala.findMany<{ include: { vehicle: true } }>>> = [];
  let entry: Awaited<ReturnType<typeof prisma.timeClockEntry.findFirst>> = null;
  let usageLogs: Awaited<ReturnType<typeof prisma.vehicleUsageLog.findMany<{ include: { vehicle: true } }>>> = [];
  let trips: Awaited<ReturnType<typeof prisma.vehicleTrip.findMany<{ include: { vehicle: true } }>>> = [];
  let fuel: Awaited<ReturnType<typeof prisma.fuelTransaction.findMany>> = [];
  let leave: Awaited<ReturnType<typeof prisma.driverLeave.findFirst>> = null;
  let effectiveVehicleId: string | null = vehicleId ?? null;

  if (ready) {
    [leave, escalas, entry, usageLogs] = await Promise.all([
      prisma.driverLeave.findFirst({
        where: { companyId: session.companyId, driverId: driverId!, startDate: { lte: dayStart! }, endDate: { gte: dayStart! } },
      }),
      prisma.escala.findMany({
        where: { companyId: session.companyId, driverId: driverId!, date: { gte: dayStart!, lt: dayEnd! } },
        include: { vehicle: true },
      }),
      prisma.timeClockEntry.findFirst({
        where: { companyId: session.companyId, driverId: driverId!, date: { gte: dayStart!, lt: dayEnd! } },
      }),
      prisma.vehicleUsageLog.findMany({
        where: {
          companyId: session.companyId,
          driverId: driverId!,
          checkInAt: { gte: dayStart!, lt: dayEnd! },
          ...(vehicleId ? { vehicleId } : {}),
        },
        include: { vehicle: true },
        orderBy: { checkInAt: "asc" },
      }),
    ]);

    escalas.sort((a, b) => toMinutes(a.startTime || "00:00") - toMinutes(b.startTime || "00:00"));

    // Sem veiculo escolhido no filtro, tenta descobrir qual foi usado nesse
    // dia (pela escala ou pelo check-in) pra ainda assim cruzar com
    // Ituran/abastecimento — mais util que simplesmente nao mostrar nada.
    if (!effectiveVehicleId) {
      effectiveVehicleId = escalas.find((e) => e.vehicleId)?.vehicleId ?? usageLogs[0]?.vehicleId ?? null;
    }

    [trips, fuel] = await Promise.all([
      effectiveVehicleId
        ? prisma.vehicleTrip.findMany({
            where: { companyId: session.companyId, vehicleId: effectiveVehicleId, startAt: { gte: dayStart!, lt: dayEnd! } },
            include: { vehicle: true },
            orderBy: { startAt: "asc" },
          })
        : Promise.resolve([]),
      prisma.fuelTransaction.findMany({
        where: {
          companyId: session.companyId,
          dataHora: { gte: dayStart!, lt: dayEnd! },
          OR: [{ driverId: driverId! }, ...(effectiveVehicleId ? [{ vehicleId: effectiveVehicleId }] : [])],
        },
        orderBy: { dataHora: "asc" },
      }),
    ]);

    if (leave) {
      alerts.push({ level: "info", text: `Motorista em ${LEAVE_LABELS[leave.leaveType] ?? leave.leaveType} nesse dia — ausência de ponto/escala é esperada.` });
    }
    if (escalas.length > 0 && !entry) {
      alerts.push({ level: "warning", text: "Tem escala no SIAT, mas nenhum ponto batido nesse dia." });
    }
    if (escalas.length === 0 && entry) {
      alerts.push({ level: "warning", text: "Tem ponto batido, mas nenhuma escala no SIAT nesse dia." });
    }
    if (entry && trips.length > 0) {
      const window = pontoWindow(entry);
      if (window.end && !trips.some((t) => windowsOverlap(window.start, window.end!, t.startAt, t.endAt, 30))) {
        alerts.push({ level: "warning", text: "Nenhuma viagem do Ituran ocorreu dentro do horário batido no ponto (tolerância de 30min)." });
      }
    }
    if (driver) {
      for (const t of trips) {
        if (t.driverNameRaw && !namesLikelyMatch(t.driverNameRaw, driver.name)) {
          alerts.push({ level: "warning", text: `Viagem do Ituran das ${format(t.startAt, "HH:mm")} está associada a outro motorista no rastreador ("${t.driverNameRaw}").` });
        }
      }
      for (const f of fuel) {
        if (f.motoristaOriginal && !namesLikelyMatch(f.motoristaOriginal, driver.name)) {
          alerts.push({ level: "warning", text: `Abastecimento das ${format(f.dataHora, "HH:mm")} veio com motorista diferente na nota fiscal ("${f.motoristaOriginal}").` });
        }
      }
    }
  }

  const effectiveVehicle = effectiveVehicleId ? vehicles.find((v) => v.id === effectiveVehicleId) : undefined;
  const worked = entry ? workedMinutes(entry) : null;

  // O SIAT as vezes tem 2+ reservas DIFERENTES (numeros distintos) pro mesmo
  // horario/veiculo/passageiro — confirmado real (2026-09-04): o proprio
  // painel do SIAT mostra 2 reservas (#1000349 e #994447) identicas em tudo
  // menos o numero. Nao e bug do nosso sync (cada uma vira uma linha de
  // Escala de proposito, sao registros diferentes) — mas listar cada uma
  // separada aqui confundia, entao agrupa por horario+veiculo pra mostrar
  // como "1 corrida, N reservas no SIAT" em vez de N corridas identicas.
  const escalaGroups = (() => {
    const map = new Map<string, { startTime: string; endTime: string | null; vehiclePlate: string; requestType: string | null; fontes: Set<string>; labels: string[]; ids: string[] }>();
    for (const e of escalas) {
      const key = `${e.startTime}|${e.endTime ?? ""}|${e.vehicleId ?? ""}`;
      const label = e.routeName || e.scaleName || e.clientName || "—";
      const existing = map.get(key);
      if (existing) {
        if (!existing.labels.includes(label)) existing.labels.push(label);
        existing.fontes.add(e.fonte ?? "Manual");
        existing.ids.push(e.siatId ?? e.id);
        if (e.requestType === "fixa") existing.requestType = "fixa";
      } else {
        map.set(key, {
          startTime: e.startTime,
          endTime: e.endTime,
          vehiclePlate: e.vehicle?.plate ?? "Sem veículo",
          requestType: e.requestType,
          fontes: new Set([e.fonte ?? "Manual"]),
          labels: [label],
          ids: [e.siatId ?? e.id],
        });
      }
    }
    return [...map.values()];
  })();

  return (
    <div className="max-w-5xl">
      <div className="mb-4" data-print-hide>
        <Link href="/utilizacao" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Voltar pra Utilização de veículos
        </Link>
      </div>

      <PageHeader
        title="Auditoria do dia"
        subtitle="Motorista, veículo e data escolhidos lado a lado com tudo que temos registrado: ponto, escala do SIAT, Ituran e abastecimento."
      />

      <form className="mb-6 flex flex-wrap items-end gap-3" method="get" data-print-hide>
        <div className="w-64">
          <ComboboxFilter name="driverId" label="Motorista" defaultValue={driverId} options={drivers.map((d) => ({ value: d.id, label: d.name }))} />
        </div>
        <div className="w-52">
          <ComboboxFilter name="vehicleId" label="Veículo" defaultValue={vehicleId} allLabel="Detectar automaticamente" options={vehicles.map((v) => ({ value: v.id, label: v.plate }))} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Data</label>
          <input type="date" name="data" defaultValue={data ?? ""} className={inputClass} />
        </div>
        <button type="submit" className={primaryButtonClass}>
          Buscar
        </button>
      </form>

      {!ready ? (
        <div className={`${cardClass} flex flex-col items-center gap-2 py-12 text-center text-slate-500`}>
          <SearchX className="h-8 w-8 text-slate-300" />
          <p className="text-sm">Escolha ao menos um motorista e uma data pra ver a auditoria do dia.</p>
        </div>
      ) : !driver ? (
        <div className={`${cardClass} py-8 text-center text-sm text-slate-500`}>Motorista não encontrado.</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-lg font-semibold text-slate-900">{driver.name}</p>
                <p className="text-sm text-slate-500">
                  {format(dayStart!, "dd/MM/yyyy")}
                  {effectiveVehicle && (
                    <>
                      {" "}
                      · veículo <span className="font-mono">{effectiveVehicle.plate}</span>
                      {!vehicleId && <span className="text-xs text-slate-400"> (detectado automaticamente)</span>}
                    </>
                  )}
                </p>
              </div>
              {alerts.length === 0 ? (
                <span className={`${badgeClass} bg-emerald-100 text-emerald-700`}>
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Sem divergências encontradas
                </span>
              ) : (
                <span className={`${badgeClass} bg-amber-100 text-amber-700`}>{alerts.length} alerta(s)</span>
              )}
            </div>
          </div>

          {alerts.length > 0 && (
            <div className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Alertas de auditoria</h2>
              <ul className="flex flex-col gap-2">
                {alerts.map((a, i) => (
                  <li
                    key={i}
                    className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                      a.level === "warning" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"
                    }`}
                  >
                    <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${a.level === "warning" ? "text-amber-500" : "text-slate-400"}`} />
                    {a.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Ponto batido</h2>
            {!entry ? (
              <p className="text-sm text-slate-400">Nenhum registro de ponto nesse dia.</p>
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-600">
                  <span>
                    Entrada: <span className="font-medium text-slate-800">{entry.clockIn}</span>
                  </span>
                  <span>
                    Saída: <span className="font-medium text-slate-800">{entry.clockOut ?? "—"}</span>
                  </span>
                  {entry.intervaloInicio && (
                    <span>
                      Intervalo: <span className="font-medium text-slate-800">{entry.intervaloInicio} – {entry.intervaloFim ?? "—"}</span>
                    </span>
                  )}
                  <span>
                    Horas trabalhadas: <span className="font-medium text-slate-800">{formatMinutes(worked ?? 0)}</span>
                  </span>
                  <span className={`${badgeClass} bg-slate-100 text-slate-600`}>{entry.fonte ?? "Manual"}</span>
                </div>
                {Array.isArray(entry.punches) && (entry.punches as unknown[]).length > 0 && (
                  <table className="w-full max-w-md text-xs">
                    <thead>
                      <tr className="text-left text-slate-400">
                        <th className="pb-1 pr-4 font-medium">Entrada</th>
                        <th className="pb-1 font-medium">Saída</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(entry.punches as { entrada: string; saida: string | null }[]).map((p, i) => (
                        <tr key={i} className="text-slate-600">
                          <td className="pr-4 py-0.5">{p.entrada}</td>
                          <td className="py-0.5">{p.saida ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Escala (SIAT)</h2>
            {escalas.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhuma escala sincronizada do SIAT nesse dia.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3">Início</th>
                      <th className="py-2 pr-3">Fim</th>
                      <th className="py-2 pr-3">Veículo</th>
                      <th className="py-2 pr-3">Rota / cliente</th>
                      <th className="py-2 pr-3">Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {escalaGroups.map((g, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-3 text-slate-700">
                          <span className="inline-flex items-center gap-1">
                            {g.startTime || "—"}
                            {g.requestType === "fixa" && (
                              <span title='Reserva "fixa" (rota recorrente) — a API do SIAT não traz o horário real dessa rota.'>
                                <AlertTriangle className="h-3 w-3 text-amber-500" />
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-slate-700">{g.endTime ?? "—"}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-slate-600">{g.vehiclePlate}</td>
                        <td className="py-2 pr-3 text-slate-600">
                          {g.labels.join(" · ")}
                          {g.ids.length > 1 && (
                            <span
                              title={`O SIAT tem ${g.ids.length} reservas separadas pra esse mesmo horário/veículo (nº ${g.ids.join(", ")}) — não é erro nosso, é assim que veio de lá.`}
                              className={`${badgeClass} ml-2 bg-amber-100 text-amber-700`}
                            >
                              {g.ids.length} reservas SIAT
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {[...g.fontes].map((f) => (
                            <span key={f} className={`${badgeClass} bg-slate-100 text-slate-600`}>
                              {f}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Check-in de veículo</h2>
            {usageLogs.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum check-in de veículo nesse dia.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3">Veículo</th>
                      <th className="py-2 pr-3">Check-in</th>
                      <th className="py-2 pr-3">Check-out</th>
                      <th className="py-2 pr-3">Km inicial</th>
                      <th className="py-2 pr-3">Km final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageLogs.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-3 font-mono text-xs text-slate-600">{l.vehicle.plate}</td>
                        <td className="py-2 pr-3 text-slate-700">{format(l.checkInAt, "HH:mm")}</td>
                        <td className="py-2 pr-3 text-slate-700">{l.checkOutAt ? format(l.checkOutAt, "HH:mm") : "Em aberto"}</td>
                        <td className="py-2 pr-3 text-slate-600">{l.kmInicial.toLocaleString("pt-BR")} km</td>
                        <td className="py-2 pr-3 text-slate-600">{l.kmFinal ? `${l.kmFinal.toLocaleString("pt-BR")} km` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Ituran (viagens do veículo)</h2>
            {!effectiveVehicleId ? (
              <p className="text-sm text-slate-400">Nenhum veículo identificado pra esse dia — escolha um no filtro pra ver as viagens do Ituran.</p>
            ) : trips.length === 0 ? (
              <div className="text-sm text-slate-400">
                <p>Nenhuma viagem registrada pelo Ituran nesse dia.</p>
                {maybeNotYetSynced(data) && (
                  <p className="mt-1 text-xs text-amber-600">
                    Esse dia é recente demais pra já estar sincronizado — nosso robô busca as viagens do Ituran 1x por
                    dia, de madrugada, e só traz o dia anterior. Se o veículo rodou hoje ou ontem à noite, confira
                    direto no site do Ituran; aqui deve aparecer amanhã.
                  </p>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3">Início</th>
                      <th className="py-2 pr-3">Fim</th>
                      <th className="py-2 pr-3">Distância</th>
                      <th className="py-2 pr-3">Vel. máx.</th>
                      <th className="py-2 pr-3">Ocioso</th>
                      <th className="py-2 pr-3">Motorista no rastreador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.map((t) => {
                      const mismatch = t.driverNameRaw && driver && !namesLikelyMatch(t.driverNameRaw, driver.name);
                      return (
                        <tr key={t.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 pr-3 text-slate-700">{format(t.startAt, "HH:mm")}</td>
                          <td className="py-2 pr-3 text-slate-700">{format(t.endAt, "HH:mm")}</td>
                          <td className="py-2 pr-3 text-slate-600">{t.distanceKm != null ? `${t.distanceKm.toFixed(1)} km` : "—"}</td>
                          <td className="py-2 pr-3 text-slate-600">{t.maxSpeedKmh != null ? `${t.maxSpeedKmh} km/h` : "—"}</td>
                          <td className="py-2 pr-3 text-slate-600">{t.idleMinutes != null ? `${t.idleMinutes}min` : "—"}</td>
                          <td className="py-2 pr-3">
                            <span className={mismatch ? `${badgeClass} bg-amber-100 text-amber-700` : "text-slate-600"}>
                              {t.driverNameRaw ?? "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Abastecimento</h2>
            {fuel.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum abastecimento nesse dia.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3">Horário</th>
                      <th className="py-2 pr-3">Posto</th>
                      <th className="py-2 pr-3">Placa</th>
                      <th className="py-2 pr-3">Motorista na nota</th>
                      <th className="py-2 pr-3">Litros</th>
                      <th className="py-2 pr-3">Valor</th>
                      <th className="py-2 pr-3">Hodômetro</th>
                      <th className="py-2 pr-3">Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fuel.map((f) => {
                      const mismatch = f.motoristaOriginal && driver && !namesLikelyMatch(f.motoristaOriginal, driver.name);
                      return (
                        <tr key={f.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 pr-3 text-slate-700">{format(f.dataHora, "HH:mm")}</td>
                          <td className="py-2 pr-3 text-slate-600">{f.posto ?? "—"}</td>
                          <td className="py-2 pr-3 font-mono text-xs text-slate-600">{f.placaOriginal}</td>
                          <td className="py-2 pr-3">
                            <span className={mismatch ? `${badgeClass} bg-amber-100 text-amber-700` : "text-slate-600"}>
                              {f.motoristaOriginal ?? "—"}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-slate-600">{f.volumeLitros.toFixed(1)} L</td>
                          <td className="py-2 pr-3 text-slate-600">{formatBRL(f.valorCents)}</td>
                          <td className="py-2 pr-3 text-slate-600">{f.hodometro ? `${f.hodometro.toLocaleString("pt-BR")} km` : "—"}</td>
                          <td className="py-2 pr-3">
                            <span className={`${badgeClass} bg-slate-100 text-slate-600`}>{f.fonte ?? "Manual"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
