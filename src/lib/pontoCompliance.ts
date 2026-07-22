import { durationMinutes, toMinutes } from "@/lib/time";

// Lei 13.103/2015 (Lei do Motorista), art. 235-C: jornada padrao de 8h/dia.
export const STANDARD_DAILY_MINUTES = 8 * 60;
// Art. 235-C, §4: intervalo minimo de 11h entre duas jornadas.
export const MIN_INTERJORNADA_MINUTES = 11 * 60;
// Regime especial 12x36 (quando o ACT/CCT do motorista preve): 12h
// trabalhadas, 36h de descanso, em vez de 8h/11h padrao.
export const REGIME_12X36_WORK_MINUTES = 12 * 60;
export const REGIME_12X36_REST_MINUTES = 36 * 60;
// Art. 59 CLT: hora extra alem de 2h/dia e considerada excessiva/abusiva.
export const EXCESSIVE_OVERTIME_MINUTES = 2 * 60;
// Art. 71 CLT: turno acima de 6h exige intervalo intrajornada registrado.
export const INTRAJORNADA_THRESHOLD_MINUTES = 6 * 60;

export type RiskLevel = "baixo" | "medio" | "alto";

export type PontoEntryLike = {
  id: string;
  driverId: string;
  date: Date;
  clockIn: string;
  clockOut: string | null;
  intervaloInicio?: string | null;
  intervaloFim?: string | null;
};

export function workedMinutes(entry: Pick<PontoEntryLike, "clockIn" | "clockOut">) {
  if (!entry.clockOut) return null;
  return durationMinutes(entry.clockIn, entry.clockOut);
}

export function intervalDurationMinutes(
  entry: Pick<PontoEntryLike, "intervaloInicio" | "intervaloFim">
): number | null {
  if (!entry.intervaloInicio || !entry.intervaloFim) return null;
  return durationMinutes(entry.intervaloInicio, entry.intervaloFim);
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
// o descanso ficou abaixo do minimo legal. `minMinutesFor` permite usar 36h
// (regime 12x36) em vez do padrao 11h quando o motorista tiver essa regra
// vigente no ACT/CCT — ver src/lib/convencao.ts:driverRegime12x36.
export function findInterjornadaViolations(
  entries: PontoEntryLike[],
  minMinutesFor: (driverId: string) => number = () => MIN_INTERJORNADA_MINUTES
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

      if (gapMinutes < minMinutesFor(driverId)) {
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

export type MissingIntervalViolation = {
  driverId: string;
  entryId: string;
  workedMinutes: number;
};

// Turno de 6h ou mais sem intervalo intrajornada registrado (art. 71 CLT).
// So sinaliza ausencia de registro — nao valida a duracao do intervalo.
export function findMissingIntervalViolations(
  entries: PontoEntryLike[]
): MissingIntervalViolation[] {
  const violations: MissingIntervalViolation[] = [];
  for (const entry of entries) {
    const worked = workedMinutes(entry);
    if (worked === null || worked < INTRAJORNADA_THRESHOLD_MINUTES) continue;
    if (!entry.intervaloInicio || !entry.intervaloFim) {
      violations.push({ driverId: entry.driverId, entryId: entry.id, workedMinutes: worked });
    }
  }
  return violations;
}

export type MissingRestViolation = {
  driverId: string;
  entryId: string;
  consecutiveDays: number;
};

// Descanso semanal remunerado (art. 67 CLT): sinaliza quando o motorista
// acumula dias corridos trabalhados sem nenhuma folga entre eles, alem do
// limiar esperado para sua escala. `maxConsecutiveDaysFor` permite usar 6
// (escala 6x1) ou 5 (escala 5x2) em vez do padrao generico de 7 dias — ver
// src/lib/convencao.ts para como a escala do motorista e resolvida.
export function findMissingWeeklyRestViolations(
  entries: PontoEntryLike[],
  maxConsecutiveDaysFor: (driverId: string) => number = () => 7
): MissingRestViolation[] {
  const byDriver = new Map<string, PontoEntryLike[]>();
  for (const entry of entries) {
    const list = byDriver.get(entry.driverId) ?? [];
    list.push(entry);
    byDriver.set(entry.driverId, list);
  }

  const violations: MissingRestViolation[] = [];
  for (const [driverId, list] of byDriver) {
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const maxConsecutiveDays = maxConsecutiveDaysFor(driverId);
    let streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prevDay = Math.round(sorted[i - 1].date.getTime() / (24 * 60 * 60 * 1000));
      const curDay = Math.round(sorted[i].date.getTime() / (24 * 60 * 60 * 1000));
      streak = curDay === prevDay + 1 ? streak + 1 : 1;
      if (streak >= maxConsecutiveDays) {
        violations.push({ driverId, entryId: sorted[i].id, consecutiveDays: streak });
      }
    }
  }
  return violations;
}

export type EscalaLike = { driverId: string; date: Date };
export type Absence = { driverId: string; date: Date };

// Chave por dia usando componentes locais do Date — nao usar toISOString
// aqui, que converte para UTC e pode deslocar o dia (mesmo bug de fuso ja
// documentado em src/lib/date.ts).
function localDayKey(driverId: string, date: Date): string {
  return `${driverId}_${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// Dias em que existe uma Escala planejada para o motorista mas nenhum
// TimeClockEntry correspondente — mesma ideia de divergencia escala x uso
// real ja usada em /utilizacao, aplicada aqui ao ponto ("dia sem registro").
export function findAbsences(escalas: EscalaLike[], entries: PontoEntryLike[]): Absence[] {
  const entryKeys = new Set(entries.map((e) => localDayKey(e.driverId, e.date)));
  const seen = new Set<string>();
  const absences: Absence[] = [];
  for (const escala of escalas) {
    const key = localDayKey(escala.driverId, escala.date);
    if (entryKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    absences.push({ driverId: escala.driverId, date: escala.date });
  }
  return absences;
}
