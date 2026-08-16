import { prisma } from "@/lib/prisma";
import { timeRangesOverlap, toMinutes } from "@/lib/time";
import { MIN_INTERJORNADA_MINUTES, REGIME_12X36_REST_MINUTES } from "@/lib/pontoCompliance";
import { driverRegime12x36 } from "@/lib/convencao";

export type EscalaConflict = {
  type: "motorista" | "veiculo";
  driverName: string;
  vehiclePlate: string;
  startTime: string;
  endTime: string;
};

export async function findEscalaConflicts(params: {
  companyId: string;
  driverId: string;
  vehicleId: string;
  date: Date;
  startTime: string;
  endTime: string;
  excludeId?: string;
}): Promise<EscalaConflict[]> {
  const dayStart = new Date(params.date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const sameDay = await prisma.escala.findMany({
    where: {
      companyId: params.companyId,
      date: { gte: dayStart, lt: dayEnd },
      id: params.excludeId ? { not: params.excludeId } : undefined,
      OR: [{ driverId: params.driverId }, { vehicleId: params.vehicleId }],
    },
    include: { driver: true, vehicle: true },
  });

  const conflicts: EscalaConflict[] = [];
  for (const escala of sameDay) {
    if (!timeRangesOverlap(params.startTime, params.endTime, escala.startTime, escala.endTime)) {
      continue;
    }
    if (escala.driverId === params.driverId) {
      conflicts.push({
        type: "motorista",
        driverName: escala.driver.name,
        vehiclePlate: escala.vehicle.plate,
        startTime: escala.startTime,
        endTime: escala.endTime,
      });
    }
    if (escala.vehicleId === params.vehicleId) {
      conflicts.push({
        type: "veiculo",
        driverName: escala.driver.name,
        vehiclePlate: escala.vehicle.plate,
        startTime: escala.startTime,
        endTime: escala.endTime,
      });
    }
  }
  return conflicts;
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

// Checagem preventiva de descanso entre turnos (art. 235-C, §4º CLT / 36h no
// regime 12x36) NO MOMENTO DE CRIAR/EDITAR a escala — diferente da checagem
// que ja existia em pontoCompliance.ts, que so constata a violacao depois
// que o motorista ja bateu o ponto. Olha apenas a escala imediatamente
// anterior e a imediatamente seguinte do MESMO motorista (qualquer veiculo)
// dentro de uma janela de +-3 dias, o suficiente pra cobrir qualquer turno
// real. Retorna avisos (nao bloqueia) — quem decide se segue mesmo assim e
// quem esta montando a escala, ver createEscala/updateEscala.
export async function findInterjornadaWarnings(params: {
  companyId: string;
  driverId: string;
  date: Date;
  startTime: string;
  endTime: string;
  excludeId?: string;
}): Promise<InterjornadaWarning[]> {
  const rangeStart = new Date(params.date);
  rangeStart.setDate(rangeStart.getDate() - 3);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(params.date);
  rangeEnd.setDate(rangeEnd.getDate() + 4);
  rangeEnd.setHours(0, 0, 0, 0);

  const [driver, nearby] = await Promise.all([
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
      select: { date: true, startTime: true, endTime: true },
    }),
  ]);
  if (!driver) return [];

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
