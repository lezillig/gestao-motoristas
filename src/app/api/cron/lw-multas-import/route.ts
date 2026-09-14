import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isLwAvailable, getLwToken, listarVeiculosLw } from "@/lib/lw/client";
import { matchVehicleToLw } from "@/lib/lw/plateMatch";
import { syncMultasForVehicle, resolveCondutoresPendentes } from "@/lib/lw/sync";
import { sleep } from "@/lib/tiquetaque/pace";
import { executarCron } from "@/lib/cronRun";

// Diario (ver vercel.json): multas de cada veiculo na LW, um veiculo por
// vez com pausa (limite da API). Nao cabe tudo numa invocacao: processa ate
// o orcamento e chama a si mesma com ?cursor=<indice> ate esgotar a frota.
export const maxDuration = 60;

const BATCH_TIME_BUDGET_MS = 45_000;
const LW_SYNC_PACE_MS = 250;

export async function GET(req: NextRequest) {
  return executarCron("lw-multas-import", req, async ({ iniciadoEm, encadear }) => {
    if (!isLwAvailable()) return { status: "pulado", detalhe: { skipped: "LW Tecnologia não configurada" } };

    const cursorRaw = parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10);
    const cursor = Number.isFinite(cursorRaw) && cursorRaw >= 0 ? cursorRaw : 0;

    const token = await getLwToken();
    const veiculosLw = await listarVeiculosLw(token);

    const companies = await prisma.company.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    const itens: { companyId: string; vehicleId: string; placaParaConsulta: string }[] = [];
    const semCorrespondencia: string[] = [];
    for (const company of companies) {
      const vehicles = await prisma.vehicle.findMany({
        where: { companyId: company.id },
        select: { id: true, plate: true },
        orderBy: { id: "asc" },
      });
      for (const vehicle of vehicles) {
        const match = matchVehicleToLw(vehicle.plate, veiculosLw);
        if (!match) {
          semCorrespondencia.push(vehicle.plate);
          continue;
        }
        itens.push({ companyId: company.id, vehicleId: vehicle.id, placaParaConsulta: match.placaParaConsulta });
      }
    }

    let criadas = 0;
    let atualizadas = 0;
    let processed = 0;
    const errors: string[] = [];

    let i = cursor;
    for (; i < itens.length; i++) {
      if (Date.now() - iniciadoEm > BATCH_TIME_BUDGET_MS) break;

      const item = itens[i];
      if (i > cursor) await sleep(LW_SYNC_PACE_MS);

      try {
        const result = await syncMultasForVehicle(item.companyId, item.vehicleId, item.placaParaConsulta, token);
        await resolveCondutoresPendentes(item.companyId, item.vehicleId);
        criadas += result.criadas;
        atualizadas += result.atualizadas;
        processed++;
      } catch (e) {
        errors.push(`${item.placaParaConsulta}: ${e instanceof Error ? e.message : "erro desconhecido"}`);
      }
    }

    const remaining = i < itens.length;
    if (remaining) encadear({ cursor: String(i) });

    return {
      status: "ok",
      processados: processed,
      erros: errors,
      continuacao: remaining,
      detalhe: {
        cursorStart: cursor,
        cursorEnd: i,
        totalVeiculos: itens.length,
        criadas,
        atualizadas,
        semCorrespondencia: cursor === 0 ? semCorrespondencia.length : undefined,
      },
    };
  });
}
