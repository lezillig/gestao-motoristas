import { durationMinutes, toMinutes } from "@/lib/time";

// Lei 13.103/2015 (Lei do Motorista), art. 235-C: jornada padrao de 8h/dia.
export const STANDARD_DAILY_MINUTES = 8 * 60;
// Art. 235-C, §4: intervalo minimo de 11h entre duas jornadas.
export const MIN_INTERJORNADA_MINUTES = 11 * 60;

export type PontoEntryLike = {
  id: string;
  driverId: string;
  date: Date;
  clockIn: string;
  clockOut: string | null;
};

export function workedMinutes(entry: Pick<PontoEntryLike, "clockIn" | "clockOut">) {
  if (!entry.clockOut) return null;
  return durationMinutes(entry.clockIn, entry.clockOut);
}

// dailyLimitMinutes permite que a jornada normal de um motorista seja
// estendida por convencao coletiva (Lei 13.103/2015 permite CCT/ACT ampliar
// a jornada base) — ver src/lib/convencao.ts:driverDailyLimitMinutes.
export function overtimeMinutes(worked: number | null, dailyLimitMinutes = STANDARD_DAILY_MINUTES) {
  if (worked === null) return 0;
  return Math.max(0, worked - dailyLimitMinutes);
}

export type InterjornadaViolation = {
  driverId: string;
  previousEntryId: string;
  nextEntryId: string;
  gapMinutes: number;
};

// Assume que cada registro representa um turno dentro do mesmo dia
// (simplificacao consistente com o modulo de escalas). Para cada motorista,
// compara o fim de um turno com o inicio do turno seguinte e sinaliza quando
// o descanso ficou abaixo do minimo legal.
export function findInterjornadaViolations(
  entries: PontoEntryLike[]
): InterjornadaViolation[] {
  const byDriver = new Map<string, PontoEntryLike[]>();
  for (const entry of entries) {
    const list = byDriver.get(entry.driverId) ?? [];
    list.push(entry);
    byDriver.set(entry.driverId, list);
  }

  const violations: InterjornadaViolation[] = [];
  for (const [driverId, list] of byDriver) {
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      if (!prev.clockOut) continue;

      const daysBetween = Math.round(
        (next.date.getTime() - prev.date.getTime()) / (24 * 60 * 60 * 1000)
      );
      const gapMinutes =
        daysBetween * 24 * 60 - toMinutes(prev.clockOut) + toMinutes(next.clockIn);

      if (gapMinutes < MIN_INTERJORNADA_MINUTES) {
        violations.push({
          driverId,
          previousEntryId: prev.id,
          nextEntryId: next.id,
          gapMinutes,
        });
      }
    }
  }
  return violations;
}
