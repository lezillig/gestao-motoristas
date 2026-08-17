import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { fetchEmployeeDays } from "@/lib/tiquetaque/client";
import { hashPontoState } from "@/lib/integrity";

export type TiqueTaqueImportRowError = { driverName: string; date?: string; message: string };
export type TiqueTaqueDriverImportResult = {
  created: number;
  corrected: number;
  errors: TiqueTaqueImportRowError[];
};

// Chave canonica pra comparar `punches` — nao dá pra usar JSON.stringify
// direto: o Postgres (jsonb) reordena as chaves de cada objeto ao salvar,
// entao um valor recem-lido do banco quase nunca bate byte-a-byte com o
// mesmo valor recem-computado, mesmo quando o conteudo e identico (bug real
// encontrado ao reimportar o mesmo periodo duas vezes e ver correcoes
// fantasma serem criadas).
function punchesKey(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((p) => {
      if (typeof p !== "object" || p === null) return "";
      const { entrada, saida } = p as { entrada?: unknown; saida?: unknown };
      return `${entrada ?? ""}|${saida ?? ""}`;
    })
    .join(",");
}

// Nucleo da importacao por motorista, sem checagem de sessao/autorizacao —
// quem chama (Server Action autenticada por role, ou rota de cron
// autenticada por secret) e responsavel por verificar que tem permissao
// antes de chamar isto. Extraido de ponto/actions.ts pra ser reusavel dos
// dois lugares (redirect() de Server Action nao funciona em Route Handler,
// entao a rota de cron nao pode chamar a Server Action original direto).
export async function importDriverDaysCore(
  companyId: string,
  driverId: string,
  driverName: string,
  employeeId: string,
  startDate: string,
  endDate: string
): Promise<TiqueTaqueDriverImportResult> {
  let days;
  try {
    days = await fetchEmployeeDays(employeeId, startDate, endDate);
  } catch (e) {
    return {
      created: 0,
      corrected: 0,
      errors: [{ driverName, message: e instanceof Error ? e.message : "Falha ao buscar batidas do TiqueTaque." }],
    };
  }

  const existingEntries = await prisma.timeClockEntry.findMany({
    where: {
      companyId,
      driverId,
      date: { gte: parseLocalDate(startDate), lte: parseLocalDate(endDate) },
    },
  });
  const existingByDate = new Map(existingEntries.map((e) => [format(e.date, "yyyy-MM-dd"), e]));

  const errors: TiqueTaqueImportRowError[] = [];
  let created = 0;
  let corrected = 0;

  for (const day of days) {
    const existing = existingByDate.get(day.date);

    if (!existing) {
      await prisma.timeClockEntry.create({
        data: {
          companyId,
          driverId,
          date: parseLocalDate(day.date),
          clockIn: day.clockIn,
          clockOut: day.clockOut,
          intervaloInicio: day.intervaloInicio,
          intervaloFim: day.intervaloFim,
          punches: day.pairs,
          fonte: "TIQUETAQUE",
          hashAtual: hashPontoState({
            clockIn: day.clockIn,
            clockOut: day.clockOut,
            intervaloInicio: day.intervaloInicio,
            intervaloFim: day.intervaloFim,
            esperaInicio: null,
            esperaFim: null,
            punches: day.pairs,
          }),
        },
      });
      created++;
      continue;
    }

    if (existing.fonte !== "TIQUETAQUE") {
      errors.push({ driverName, date: day.date, message: "Já existe registro de ponto nesta data — não sobrescrito." });
      continue;
    }

    // Registro ja veio do TiqueTaque antes: se os horarios ou os pares
    // entrada/saida vieram diferentes desta vez, e porque a correcao foi
    // feita direto no TiqueTaque — atualiza e guarda o antes/depois em
    // TimeClockCorrection (nunca sobrescreve sem deixar rastro), em vez de
    // reportar como conflito. Compara `punches` tambem (nao so os 4 campos
    // planos) porque uma correcao dentro de uma pausa do meio do dia pode
    // nao mudar o primeiro horario nem o ultimo. `punchesKey` so olha
    // entrada/saida (nao geolocalizacao/tipo de registro) de proposito —
    // ver backfill de metadado logo abaixo.
    const changed =
      existing.clockIn !== day.clockIn ||
      existing.clockOut !== day.clockOut ||
      existing.intervaloInicio !== day.intervaloInicio ||
      existing.intervaloFim !== day.intervaloFim ||
      punchesKey(existing.punches) !== punchesKey(day.pairs);
    if (!changed) {
      // Horario bate, mas o par pode trazer metadado que a importacao
      // original nao capturava ainda (geolocalizacao/tipo de registro,
      // adicionados depois — reimportar um periodo ja importado antes e
      // como isso e retroativamente preenchido). Atualiza so `punches`,
      // SEM criar TimeClockCorrection: nao e uma correcao de jornada (a
      // jornada continua identica), so enriquecimento de um dado que ja
      // estava certo — registrar isso como "correcao" poluiria o
      // historico de /ponto/correcoes com entradas que nao mudam nenhum
      // horario, so a presenca de metadado.
      if (JSON.stringify(existing.punches) !== JSON.stringify(day.pairs)) {
        await prisma.timeClockEntry.update({
          where: { id: existing.id },
          data: { punches: day.pairs },
        });
      }
      continue;
    }

    const stateAntes = {
      clockIn: existing.clockIn,
      clockOut: existing.clockOut,
      intervaloInicio: existing.intervaloInicio,
      intervaloFim: existing.intervaloFim,
      esperaInicio: existing.esperaInicio,
      esperaFim: existing.esperaFim,
      punches: existing.punches,
    };
    const stateDepois = {
      clockIn: day.clockIn,
      clockOut: day.clockOut,
      intervaloInicio: day.intervaloInicio,
      intervaloFim: day.intervaloFim,
      esperaInicio: existing.esperaInicio,
      esperaFim: existing.esperaFim,
      punches: day.pairs,
    };
    const hashAntes = existing.hashAtual ?? hashPontoState(stateAntes);
    const hashDepois = hashPontoState(stateDepois);

    await prisma.$transaction([
      prisma.timeClockEntry.update({
        where: { id: existing.id },
        data: {
          clockIn: day.clockIn,
          clockOut: day.clockOut,
          intervaloInicio: day.intervaloInicio,
          intervaloFim: day.intervaloFim,
          punches: day.pairs,
          hashAtual: hashDepois,
        },
      }),
      prisma.timeClockCorrection.create({
        data: {
          companyId,
          driverId,
          entryId: existing.id,
          date: existing.date,
          origem: "TIQUETAQUE_REIMPORT",
          clockInAntes: existing.clockIn,
          clockOutAntes: existing.clockOut,
          intervaloInicioAntes: existing.intervaloInicio,
          intervaloFimAntes: existing.intervaloFim,
          punchesAntes: existing.punches ?? undefined,
          clockInDepois: day.clockIn,
          clockOutDepois: day.clockOut,
          intervaloInicioDepois: day.intervaloInicio,
          intervaloFimDepois: day.intervaloFim,
          punchesDepois: day.pairs,
          hashAntes,
          hashDepois,
        },
      }),
    ]);
    corrected++;
  }

  return { created, corrected, errors };
}
