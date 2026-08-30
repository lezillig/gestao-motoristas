import { format, addDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { parsePunches } from "@/lib/pontoCompliance";
import type { TimeClockEntry } from "@prisma/client";

// A Ituran nao expoe um log confiavel de ignicao ligada/desligada (o
// endpoint /api/v2/events devolve so o ultimo evento de cada tipo de
// alerta, sem paginacao real, e nunca traz "Ignicao ligada" nos testes
// feitos) — ver decisao com o usuario. Viagem real (VehicleTrip, ja
// coletada pelo cron do Ituran e ja cruzada com Escala em /telemetria/
// viagens) e o proxy disponivel mais proximo de "o veiculo estava em uso".

function combineDateAndTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

export type PontoWindow = { start: Date; end: Date | null };

// Janela de presenca do motorista no dia: primeira entrada ate ultima saida
// registrada — nao desconta intervalo/espera de proposito, aqui so importa
// se o veiculo andou DENTRO do periodo em que o motorista estava de
// servico, nao o total de horas trabalhadas (isso ja e outro relatorio).
export function pontoWindow(
  entry: Pick<TimeClockEntry, "date" | "clockIn" | "clockOut" | "punches">
): PontoWindow {
  const punches = parsePunches(entry.punches);
  if (punches.length > 0) {
    const start = combineDateAndTime(entry.date, punches[0].entrada);
    const last = punches[punches.length - 1];
    if (!last.saida) return { start, end: null };
    let end = combineDateAndTime(entry.date, last.saida);
    if (end < start) end = addDays(end, 1);
    return { start, end };
  }
  const start = combineDateAndTime(entry.date, entry.clockIn);
  if (!entry.clockOut) return { start, end: null };
  let end = combineDateAndTime(entry.date, entry.clockOut);
  if (end < start) end = addDays(end, 1);
  return { start, end };
}

function windowsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date, toleranceMinutes: number): boolean {
  const tol = toleranceMinutes * 60 * 1000;
  return aStart.getTime() - tol < bEnd.getTime() && bStart.getTime() - tol < aEnd.getTime();
}

// Tolerancia pra nao gerar falso positivo por pequenas diferencas entre o
// horario batido no ponto e o horario real de deslocamento (deslocamento a
// pe ate o veiculo, transito no patio etc.).
const OVERLAP_TOLERANCE_MINUTES = 30;

export type PontoSemViagem = {
  driverId: string;
  driverName: string;
  vehiclePlate: string;
  date: Date;
  pontoStart: Date;
  pontoEnd: Date;
};

export type ViagemSemPonto = {
  vehiclePlate: string;
  tripStart: Date;
  tripEnd: Date;
  distanceKm: number | null;
};

export async function buildViagemPontoAudit(
  companyId: string,
  monthStart: Date,
  monthEndExclusive: Date
): Promise<{ pontoSemViagem: PontoSemViagem[]; viagemSemPonto: ViagemSemPonto[]; escalasComPontoAbertoOuAusente: number }> {
  const escalas = await prisma.escala.findMany({
    where: { companyId, date: { gte: monthStart, lt: monthEndExclusive } },
    include: { driver: true, vehicle: true },
  });

  const scheduledVehicleIds = [...new Set(escalas.map((e) => e.vehicleId))];
  const driverIds = [...new Set(escalas.map((e) => e.driverId))];

  const [entries, trips] = await Promise.all([
    prisma.timeClockEntry.findMany({
      where: { companyId, driverId: { in: driverIds }, date: { gte: monthStart, lt: monthEndExclusive } },
    }),
    scheduledVehicleIds.length === 0
      ? Promise.resolve([])
      : prisma.vehicleTrip.findMany({
          where: { companyId, vehicleId: { in: scheduledVehicleIds }, startAt: { gte: monthStart, lt: monthEndExclusive } },
          include: { vehicle: true },
        }),
  ]);

  const entryByDriverDate = new Map(entries.map((e) => [`${e.driverId}_${format(e.date, "yyyy-MM-dd")}`, e]));
  const tripsByVehicleDate = new Map<string, typeof trips>();
  for (const t of trips) {
    const key = `${t.vehicleId}_${format(t.startAt, "yyyy-MM-dd")}`;
    const list = tripsByVehicleDate.get(key) ?? [];
    list.push(t);
    tripsByVehicleDate.set(key, list);
  }

  const pontoSemViagem: PontoSemViagem[] = [];
  const matchedTripIds = new Set<string>();
  let escalasComPontoAbertoOuAusente = 0;

  for (const escala of escalas) {
    const dayKey = format(escala.date, "yyyy-MM-dd");
    const entry = entryByDriverDate.get(`${escala.driverId}_${dayKey}`);
    if (!entry) continue; // falta de ponto no dia ja e coberto por /ponto/analise (Absenteismo)

    const window = pontoWindow(entry);
    if (!window.end) {
      escalasComPontoAbertoOuAusente++;
      continue; // turno ainda aberto, nao da pra auditar ainda
    }

    const dayTrips = tripsByVehicleDate.get(`${escala.vehicleId}_${dayKey}`) ?? [];
    let hasOverlap = false;
    for (const t of dayTrips) {
      if (windowsOverlap(window.start, window.end, t.startAt, t.endAt, OVERLAP_TOLERANCE_MINUTES)) {
        hasOverlap = true;
        matchedTripIds.add(t.id);
      }
    }

    if (!hasOverlap) {
      pontoSemViagem.push({
        driverId: escala.driverId,
        driverName: escala.driver.name,
        vehiclePlate: escala.vehicle.plate,
        date: escala.date,
        pontoStart: window.start,
        pontoEnd: window.end,
      });
    }
  }

  const viagemSemPonto: ViagemSemPonto[] = trips
    .filter((t) => !matchedTripIds.has(t.id))
    .map((t) => ({
      vehiclePlate: t.vehicle.plate,
      tripStart: t.startAt,
      tripEnd: t.endAt,
      distanceKm: t.distanceKm,
    }));

  return { pontoSemViagem, viagemSemPonto, escalasComPontoAbertoOuAusente };
}
