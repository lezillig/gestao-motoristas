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

export type UsoParaResolucao = { driverId: string; checkInAt: Date; checkOutAt: Date | null };
export type EscalaParaResolucao = { driverId: string; date: Date; startTime: string; endTime: string | null };

const VAZIO: ResolveCondutorResult = { driverId: null, origem: null, candidatos: 0 };

// dataInfracao e um ROTULO de data (ver parseLwDateLabel em lw/sync.ts) —
// usa format() com os componentes LOCAIS do Date, nunca toISOString(),
// mesmo cuidado ja documentado neste projeto pra esse tipo de campo.
function momentoDaInfracao(input: ResolveCondutorInput): { dateISO: string; instant: Date | null } | null {
  if (!input.vehicleId || !input.dataInfracao) return null;
  const dateISO = format(input.dataInfracao, "yyyy-MM-dd");
  const instant = input.horaInfracao ? combineLocalDateTime(dateISO, input.horaInfracao) : null;
  return { dateISO, instant: instant && !Number.isNaN(instant.getTime()) ? instant : null };
}

// Resolve quem estava dirigindo o veiculo no momento da infracao, cruzando
// com o uso real (VehicleUsageLog, prioridade — reflete quem de fato pegou o
// veiculo) e, na falta disso, a Escala planejada. Versao pura: recebe os usos
// e escalas do veiculo ja carregados, pra resolver varias multas do mesmo
// veiculo sem consultar o banco uma vez por multa. Nunca envia nada pra LW —
// so preenche um candidato pra confirmacao humana.
export function resolverCondutorComDados(
  input: ResolveCondutorInput,
  usos: UsoParaResolucao[],
  escalas: EscalaParaResolucao[]
): ResolveCondutorResult {
  const momento = momentoDaInfracao(input);
  if (!momento) return VAZIO;
  const { dateISO, instant } = momento;

  if (instant) {
    const driversUso = new Set(
      usos.filter((u) => u.checkInAt <= instant && (u.checkOutAt == null || u.checkOutAt >= instant)).map((u) => u.driverId)
    );
    if (driversUso.size === 1) return { driverId: [...driversUso][0], origem: "USO_VEICULO_AUTOMATICO", candidatos: 1 };
    if (driversUso.size > 1) return { driverId: null, origem: null, candidatos: driversUso.size };
  }

  const dia = parseLocalDate(dateISO).getTime();
  const driversEscala = new Set(
    escalas
      .filter((e) => e.date.getTime() === dia)
      .filter((e) => {
        if (!input.horaInfracao) return true;
        const hora = toMinutes(input.horaInfracao);
        const inicio = toMinutes(e.startTime);
        const fim = e.endTime ? toMinutes(e.endTime) : inicio + 24 * 60; // sem fim informado: nao descarta so por isso
        return fim >= inicio ? hora >= inicio && hora <= fim : hora >= inicio || hora <= fim; // vira meia-noite
      })
      .map((e) => e.driverId)
  );

  if (driversEscala.size === 1) return { driverId: [...driversEscala][0], origem: "ESCALA_AUTOMATICA", candidatos: 1 };
  return { driverId: null, origem: null, candidatos: driversEscala.size };
}

// Versao com consulta, pra uma multa isolada (assistente).
export async function resolveCondutorParaMulta(input: ResolveCondutorInput): Promise<ResolveCondutorResult> {
  const momento = momentoDaInfracao(input);
  if (!momento || !input.vehicleId) return VAZIO;
  const { dateISO, instant } = momento;
  const [usos, escalas] = await Promise.all([
    instant
      ? prisma.vehicleUsageLog.findMany({
          where: { vehicleId: input.vehicleId, checkInAt: { lte: instant }, OR: [{ checkOutAt: null }, { checkOutAt: { gte: instant } }] },
          select: { driverId: true, checkInAt: true, checkOutAt: true },
        })
      : Promise.resolve([] as UsoParaResolucao[]),
    prisma.escala.findMany({
      where: { vehicleId: input.vehicleId, date: parseLocalDate(dateISO) },
      select: { driverId: true, date: true, startTime: true, endTime: true },
    }),
  ]);
  return resolverCondutorComDados(input, usos, escalas);
}
