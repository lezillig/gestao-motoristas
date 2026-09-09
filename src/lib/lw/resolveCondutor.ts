import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { combineLocalDateTime, parseLocalDate } from "@/lib/date";
import { toMinutes } from "@/lib/time";

export interface ResolveCondutorInput {
  vehicleId: string | null;
  dataInfracao: Date | null;
  horaInfracao: string | null;
}

export interface ResolveCondutorResult {
  driverId: string | null;
  origem: string | null;
  candidatos: number;
}

// Resolve automaticamente quem estava dirigindo o veiculo no momento da
// infracao, cruzando com o uso real (VehicleUsageLog, prioridade — reflete
// quem de fato pegou o veiculo) e, na falta disso, a Escala planejada.
// Mesma logica de divergencia ja usada em /utilizacao (escala x uso real),
// so que aplicada no sentido inverso: dado um instante, achar o motorista.
// Nunca envia nada pra LW sozinho — so preenche um candidato pra
// confirmacao humana (ver IndicacaoCondutor.status no schema).
export async function resolveCondutorParaMulta(input: ResolveCondutorInput): Promise<ResolveCondutorResult> {
  if (!input.vehicleId || !input.dataInfracao) return { driverId: null, origem: null, candidatos: 0 };

  // dataInfracao e um ROTULO de data (ver parseLwDateLabel em lw/sync.ts) —
  // usa format() com os componentes LOCAIS do Date, nunca toISOString(),
  // mesmo cuidado ja documentado neste projeto pra esse tipo de campo.
  const dateISO = format(input.dataInfracao, "yyyy-MM-dd");
  const instant = input.horaInfracao ? combineLocalDateTime(dateISO, input.horaInfracao) : null;

  if (instant && !Number.isNaN(instant.getTime())) {
    const usos = await prisma.vehicleUsageLog.findMany({
      where: {
        vehicleId: input.vehicleId,
        checkInAt: { lte: instant },
        OR: [{ checkOutAt: null }, { checkOutAt: { gte: instant } }],
      },
      select: { driverId: true },
    });
    const driversUso = new Set(usos.map((u) => u.driverId));
    if (driversUso.size === 1) {
      return { driverId: [...driversUso][0], origem: "USO_VEICULO_AUTOMATICO", candidatos: 1 };
    }
    if (driversUso.size > 1) {
      return { driverId: null, origem: null, candidatos: driversUso.size };
    }
  }

  const escalas = await prisma.escala.findMany({
    where: { vehicleId: input.vehicleId, date: parseLocalDate(dateISO) },
    select: { driverId: true, startTime: true, endTime: true },
  });
  const driversEscala = new Set(
    escalas
      .filter((e) => {
        if (!input.horaInfracao) return true;
        const hora = toMinutes(input.horaInfracao);
        const inicio = toMinutes(e.startTime);
        const fim = e.endTime ? toMinutes(e.endTime) : inicio + 24 * 60; // sem fim informado: nao descarta so por isso
        return fim >= inicio ? hora >= inicio && hora <= fim : hora >= inicio || hora <= fim; // vira meia-noite
      })
      .map((e) => e.driverId)
  );

  if (driversEscala.size === 1) {
    return { driverId: [...driversEscala][0], origem: "ESCALA_AUTOMATICA", candidatos: 1 };
  }
  return { driverId: null, origem: null, candidatos: driversEscala.size };
}
