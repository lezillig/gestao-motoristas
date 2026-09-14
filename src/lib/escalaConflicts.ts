import { prisma } from "@/lib/prisma";
import { timeRangesOverlap, toMinutes } from "@/lib/time";
import { MIN_INTERJORNADA_MINUTES, REGIME_12X36_REST_MINUTES } from "@/lib/pontoCompliance";
import { driverRegime12x36 } from "@/lib/convencao";

export type MotoristaParaInterjornada = Parameters<typeof driverRegime12x36>[0];

export type EscalaConflict = {
  type: "motorista" | "veiculo";
  driverName: string;
  vehiclePlate: string;
  startTime: string;
  endTime: string;
};

// Forma minima de uma escala pras duas checagens abaixo. Existe pra que as
// checagens rodem em memoria: o sync do SIAT pre-carrega a janela inteira
// uma vez em vez de consultar o banco 3 vezes por reserva (N+1). A tela de
// escala continua usando os wrappers async, que consultam e delegam.
export type EscalaParaChecagem = {
  id: string;
  driverId: string;
  vehicleId: string | null;
  date: Date;
  startTime: string;
  endTime: string | null;
  driverName: string;
  vehiclePlate: string | null;
};

export type ParamsConflito = {
  driverId: string;
  // Null/undefined pro Plantao sincronizado do SIAT, que pode ainda nao ter
  // veiculo definido — nesse caso so a checagem por motorista roda (sem
  // veiculo real, nao ha veiculo em duplo-uso pra checar).
  vehicleId?: string | null;
  date: Date;
  startTime: string;
  endTime: string;
  excludeId?: string;
};

function limitesDoDia(date: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
}

export function calcularConflitosEscala(params: ParamsConflito, candidatas: Iterable<EscalaParaChecagem>): EscalaConflict[] {
  const { dayStart, dayEnd } = limitesDoDia(params.date);
  const conflicts: EscalaConflict[] = [];
  for (const escala of candidatas) {
    if (params.excludeId && escala.id === params.excludeId) continue;
    if (escala.date < dayStart || escala.date >= dayEnd) continue;
    const doMotorista = escala.driverId === params.driverId;
    const doVeiculo = Boolean(params.vehicleId) && escala.vehicleId === params.vehicleId;
    if (!doMotorista && !doVeiculo) continue;
    // Sem horario de fim (reserva do SIAT sem trip_end_time) nao da pra
    // checar sobreposicao — nao entra na comparacao.
    if (!escala.endTime) continue;
    if (!timeRangesOverlap(params.startTime, params.endTime, escala.startTime, escala.endTime)) continue;
    const base = { driverName: escala.driverName, vehiclePlate: escala.vehiclePlate ?? "—", startTime: escala.startTime, endTime: escala.endTime };
    if (doMotorista) conflicts.push({ type: "motorista", ...base });
    if (doVeiculo) conflicts.push({ type: "veiculo", ...base });
  }
  return conflicts;
}

export async function findEscalaConflicts(params: ParamsConflito & { companyId: string }): Promise<EscalaConflict[]> {
  const { dayStart, dayEnd } = limitesDoDia(params.date);
  const sameDay = await prisma.escala.findMany({
    where: {
      companyId: params.companyId,
      date: { gte: dayStart, lt: dayEnd },
      id: params.excludeId ? { not: params.excludeId } : undefined,
      OR: [{ driverId: params.driverId }, ...(params.vehicleId ? [{ vehicleId: params.vehicleId }] : [])],
    },
    select: {
      id: true,
      driverId: true,
      vehicleId: true,
      date: true,
      startTime: true,
      endTime: true,
      driver: { select: { name: true } },
      vehicle: { select: { plate: true } },
    },
  });
  return calcularConflitosEscala(
    params,
    sameDay.map((e) => ({
      id: e.id,
      driverId: e.driverId,
      vehicleId: e.vehicleId,
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      driverName: e.driver.name,
      vehiclePlate: e.vehicle?.plate ?? null,
    }))
  );
}

export type InterjornadaWarning = {
  direction: "anterior" | "seguinte";
  gapMinutes: number;
  minRequiredMinutes: number;
  adjacentDate: Date;
  adjacentStartTime: string;
  adjacentEndTime: string;
};

type EscalaTimeLike = { date: Date; startTime: string; endTime: string };

export type ParamsInterjornada = {
  driverId: string;
  date: Date;
  startTime: string;
  endTime: string;
  excludeId?: string;
};

// Janela de +-3 dias em volta do turno — o suficiente pra cobrir qualquer
// turno vizinho real.
export function janelaInterjornada(date: Date): { rangeStart: Date; rangeEnd: Date } {
  const rangeStart = new Date(date);
  rangeStart.setDate(rangeStart.getDate() - 3);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(date);
  rangeEnd.setDate(rangeEnd.getDate() + 4);
  rangeEnd.setHours(0, 0, 0, 0);
  return { rangeStart, rangeEnd };
}

// Checagem preventiva de descanso entre turnos (art. 235-C, §4º CLT / 36h no
// regime 12x36) NO MOMENTO DE CRIAR/EDITAR a escala — diferente da checagem
// que ja existia em pontoCompliance.ts, que so constata a violacao depois
// que o motorista ja bateu o ponto. Olha apenas a escala imediatamente
// anterior e a imediatamente seguinte do MESMO motorista (qualquer veiculo).
// Retorna avisos (nao bloqueia) — quem decide se segue mesmo assim e quem
// esta montando a escala, ver createEscala/updateEscala.
export function calcularInterjornada(
  driver: MotoristaParaInterjornada,
  params: ParamsInterjornada,
  candidatas: Iterable<{ id: string; driverId: string; date: Date; startTime: string; endTime: string | null }>
): InterjornadaWarning[] {
  const { rangeStart, rangeEnd } = janelaInterjornada(params.date);

  // Escala sem horario de fim (reserva do SIAT sem trip_end_time) nao
  // participa — nao da pra calcular a folga sem saber quando o turno termina.
  const nearby: EscalaTimeLike[] = [];
  for (const c of candidatas) {
    if (c.driverId !== params.driverId) continue;
    if (params.excludeId && c.id === params.excludeId) continue;
    if (c.date < rangeStart || c.date >= rangeEnd) continue;
    if (c.endTime == null) continue;
    nearby.push({ date: c.date, startTime: c.startTime, endTime: c.endTime });
  }

  const candidate: EscalaTimeLike = { date: params.date, startTime: params.startTime, endTime: params.endTime };
  const sorted = [...nearby, candidate].sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    return dateDiff !== 0 ? dateDiff : a.startTime.localeCompare(b.startTime);
  });
  const index = sorted.indexOf(candidate);
  const before = index > 0 ? sorted[index - 1] : null;
  const after = index < sorted.length - 1 ? sorted[index + 1] : null;

  const minRequiredMinutes = driverRegime12x36(driver).ativo ? REGIME_12X36_REST_MINUTES : MIN_INTERJORNADA_MINUTES;
  const warnings: InterjornadaWarning[] = [];

  if (before) {
    const daysBetween = Math.round((candidate.date.getTime() - before.date.getTime()) / (24 * 60 * 60 * 1000));
    const gapMinutes = daysBetween * 24 * 60 - toMinutes(before.endTime) + toMinutes(candidate.startTime);
    if (gapMinutes < minRequiredMinutes) {
      warnings.push({
        direction: "anterior",
        gapMinutes,
        minRequiredMinutes,
        adjacentDate: before.date,
        adjacentStartTime: before.startTime,
        adjacentEndTime: before.endTime,
      });
    }
  }
  if (after) {
    const daysBetween = Math.round((after.date.getTime() - candidate.date.getTime()) / (24 * 60 * 60 * 1000));
    const gapMinutes = daysBetween * 24 * 60 - toMinutes(candidate.endTime) + toMinutes(after.startTime);
    if (gapMinutes < minRequiredMinutes) {
      warnings.push({
        direction: "seguinte",
        gapMinutes,
        minRequiredMinutes,
        adjacentDate: after.date,
        adjacentStartTime: after.startTime,
        adjacentEndTime: after.endTime,
      });
    }
  }
  return warnings;
}

export async function findInterjornadaWarnings(params: ParamsInterjornada & { companyId: string }): Promise<InterjornadaWarning[]> {
  const { rangeStart, rangeEnd } = janelaInterjornada(params.date);
  const [driver, nearbyRaw] = await Promise.all([
    prisma.driver.findUnique({
      where: { id: params.driverId, companyId: params.companyId },
      include: { sindicato: { include: { convencoes: { include: { regras: true } } } } },
    }),
    prisma.escala.findMany({
      where: {
        companyId: params.companyId,
        driverId: params.driverId,
        date: { gte: rangeStart, lt: rangeEnd },
        id: params.excludeId ? { not: params.excludeId } : undefined,
      },
      select: { id: true, driverId: true, date: true, startTime: true, endTime: true },
    }),
  ]);
  if (!driver) return [];
  return calcularInterjornada(driver, params, nearbyRaw);
}
