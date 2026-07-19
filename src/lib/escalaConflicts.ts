import { prisma } from "@/lib/prisma";
import { timeRangesOverlap } from "@/lib/time";

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
