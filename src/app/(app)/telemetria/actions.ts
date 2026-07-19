"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getActiveTelemetryProvider } from "@/lib/telemetry";

export async function generateReadings() {
  const session = await requireRole("ADMIN", "GESTOR");

  const vehicles = await prisma.vehicle.findMany({
    where: { companyId: session.companyId, status: { not: "INATIVO" } },
  });

  if (vehicles.length > 0) {
    const provider = getActiveTelemetryProvider();
    const readings = await provider.fetchReadings(vehicles.map((v) => v.id));

    await prisma.telemetryReading.createMany({
      data: readings.map((r) => ({
        companyId: session.companyId,
        vehicleId: r.vehicleId,
        speedKmh: r.speedKmh,
        latitude: r.latitude,
        longitude: r.longitude,
        recordedAt: r.recordedAt,
        provider: provider.name,
      })),
    });
  }

  revalidatePath("/telemetria");
  redirect("/telemetria");
}
