import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getActiveTelemetryProvider } from "@/lib/telemetry";

// Stream de progresso (SSE) do botao "Gerar leituras" — a busca na Ituran e
// paginada (ver fetchVehiclesRealtime) e antes rodava sem nenhum feedback
// visivel ate terminar, parecendo travado. Cada evento e um JSON por linha
// "data: ...\n\n"; o cliente (GerarLeiturasButton) le e mostra o progresso.
export async function POST() {
  const session = await requireRole("ADMIN", "GESTOR");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        const vehicles = await prisma.vehicle.findMany({
          where: { companyId: session.companyId, status: { not: "INATIVO" } },
        });
        const provider = getActiveTelemetryProvider();
        send({ status: "iniciando", provider: provider.name, total: vehicles.length });

        let count = 0;
        if (vehicles.length > 0) {
          const readings = await provider.fetchReadings(
            vehicles.map((v) => v.id),
            (progress) => send({ status: "buscando", ...progress })
          );
          await prisma.telemetryReading.createMany({
            data: readings.map((r) => ({
              companyId: session.companyId,
              vehicleId: r.vehicleId,
              speedKmh: r.speedKmh,
              latitude: r.latitude,
              longitude: r.longitude,
              odometerKm: r.odometerKm ?? null,
              speedLimitKmh: r.speedLimitKmh ?? null,
              recordedAt: r.recordedAt,
              provider: provider.name,
            })),
          });
          count = readings.length;
        }
        send({ status: "concluido", count });
      } catch (e) {
        send({ status: "erro", message: e instanceof Error ? e.message : "Falha ao gerar leituras." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
