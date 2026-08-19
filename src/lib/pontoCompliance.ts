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

// entradaLocation/saidaLocation: [latitude, longitude] da batida, quando
// veio do TiqueTaque com geolocalizacao (registro via app) — ver
// src/lib/tiquetaque/types.ts. So lancamento manual nunca tem isso.
// entradaType/saidaType: "type" cru da batida no TiqueTaque (ex.: "app").
export type PunchPair = {
  entrada: string;
  saida: string | null;
  entradaLocation?: [number, number] | null;
  saidaLocation?: [number, number] | null;
  entradaType?: string | null;
  saidaType?: string | null;
};

export type PontoEntryLike = {
  id: string;
  driverId: string;
  date: Date;
  clockIn: string;
  clockOut: string | null;
  intervaloInicio?: string | null;
  intervaloFim?: string | null;
  // Tempo de espera (art. 235-C, §§8-9, Lei 13.103/2015) — nao e jornada
  // normal nem hora extra, ver waitingMinutes() abaixo.
  esperaInicio?: string | null;
  esperaFim?: string | null;
  // Pares completos entrada/saida do dia (importacao TiqueTaque, quando ha
  // mais de 1 pausa) — ver comentario no schema, model TimeClockEntry.
  punches?: unknown;
};

export function parsePunches(value: unknown): PunchPair[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is PunchPair =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as Record<string, unknown>).entrada === "string" &&
      ((v as Record<string, unknown>).saida === null || typeof (v as Record<string, unknown>).saida === "string")
  );
}

// Soma o tempo de cada intervalo trabalhado (entrada->saida), nunca o vao
// entre o primeiro registro e o ultimo — um dia com pausa no meio nao pode
// contar a pausa como trabalhada. Quando `punches` esta presente (dias com
// mais de 1 pausa, so possivel via importacao TiqueTaque), e a fonte de
// verdade; senao usa clockIn/clockOut menos o unico intervalo registrado
// (intervaloInicio/Fim), cobrindo lancamento manual e o caso de 1 pausa.
export function workedMinutes(
  entry: Pick<
    PontoEntryLike,
    "clockIn" | "clockOut" | "intervaloInicio" | "intervaloFim" | "esperaInicio" | "esperaFim" | "punches"
  >
) {
  const punches = parsePunches(entry.punches);
  if (punches.length > 0) {
    const last = punches[punches.length - 1];
    if (!last.saida) return null; // turno ainda aberto
    return punches.reduce((sum, p) => sum + (p.saida ? durationMinutes(p.entrada, p.saida) : 0), 0);
  }

  if (!entry.clockOut) return null;
  const total = durationMinutes(entry.clockIn, entry.clockOut);
  const intervalo = intervalDurationMinutes(entry) ?? 0;
  // Tempo de espera nao conta como jornada trabalhada (art. 235-C, §8º, Lei
  // 13.103/2015) — descontado do mesmo jeito que o intervalo intrajornada.
  const espera = waitingMinutes(entry);
  return total - intervalo - espera;
}

export function intervalDurationMinutes(
  entry: Pick<PontoEntryLike, "intervaloInicio" | "intervaloFim">
): number | null {
  if (!entry.intervaloInicio || !entry.intervaloFim) return null;
  return durationMinutes(entry.intervaloInicio, entry.intervaloFim);
}

// Tempo de espera (art. 235-C, §§8-9, Lei 13.103/2015): motorista parado
// aguardando carga/descarga ou embarque/desembarque de passageiros — nao e
// jornada normal nem gera hora extra, mas e indenizado a parte (percentual
// sobre a hora normal, ver src/lib/convencao.ts:waitingTimeIndemnityCents).
// So capturavel via lancamento manual (a API do TiqueTaque nao distingue
// esse tipo de pausa de um intervalo comum).
export function waitingMinutes(entry: Pick<PontoEntryLike, "esperaInicio" | "esperaFim">): number {
  if (!entry.esperaInicio || !entry.esperaFim) return 0;
  return durationMinutes(entry.esperaInicio, entry.esperaFim);
}

// Duracao abaixo da qual um par entrada/saida que cruza a virada do dia
// (saida menor que entrada, ex. 23:12->01:12) e sinalizado como possivel
// pareamento errado, pra revisao manual — nao muda nenhum calculo, so
// avisa. Contexto (2026-08-18): a importacao do TiqueTaque pareia batidas
// avulsas por posicao/plausibilidade de duracao (src/lib/tiquetaque/
// pairing.ts), sem nenhum sinal real de "isso e entrada" vs "isso e saida"
// — confirmado que a API publica no expoe essa direcao. Um caso real
// encontrado comparando com o extrato oficial (motorista com jornada em 3
// pares no dia): a ENTRADA real do dia seguinte foi consumida como SAIDA de
// um par curto (2h) que na verdade nao existia. Turnos noturnos genuinos
// (ex. regime 12x36 "18:00 as 06:00") duram bem mais que isso — o limite
// aqui e deliberadamente curto pra nao marcar turno noturno real como
// suspeito, so o padrao curto que indicou o bug real.
export const SUSPICIOUS_CROSS_DAY_PAIR_MINUTES = 4 * 60;

export type SuspiciousCrossDayPair = {
  entryId: string;
  driverId: string;
  date: Date;
  entrada: string;
  saida: string;
  minutes: number;
};

// So sinaliza, nunca corrige sozinho — ver comentario acima. Cobre tanto
// dias com `punches` (varios pares, importacao TiqueTaque) quanto o par
// unico clockIn/clockOut (lancamento manual ou dia com 1 turno so).
export function findSuspiciousCrossDayPairs(
  entries: (PontoEntryLike & { id: string; driverId: string })[]
): SuspiciousCrossDayPair[] {
  const results: SuspiciousCrossDayPair[] = [];
  for (const entry of entries) {
    const punches = parsePunches(entry.punches);
    const pairs = punches.length > 0 ? punches : [{ entrada: entry.clockIn, saida: entry.clockOut }];
    for (const p of pairs) {
      if (!p.saida || p.saida >= p.entrada) continue; // nao cruza a virada
      const minutes = durationMinutes(p.entrada, p.saida);
      if (minutes < SUSPICIOUS_CROSS_DAY_PAIR_MINUTES) {
        results.push({ entryId: entry.id, driverId: entry.driverId, date: entry.date, entrada: p.entrada, saida: p.saida, minutes });
      }
    }
  }
  return results;
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

// Art. 73 CLT: periodo noturno vai das 22h de um dia as 5h do dia seguinte.
export const NIGHT_START_MINUTES = 22 * 60;
export const NIGHT_END_MINUTES = 5 * 60;

function nightOverlapMinutes(entradaAbs: number, saidaAbs: number, windowStart: number, windowEnd: number): number {
  return Math.max(0, Math.min(saidaAbs, windowEnd) - Math.max(entradaAbs, windowStart));
}

// Minutos de um segmento (entrada->saida, ja convertidos pra minutos desde
// 00h do dia da entrada) que caem dentro do periodo noturno — soma a
// sobreposicao com a janela desta noite (22h do dia do turno ate 5h do dia
// seguinte) e com a cauda da noite anterior (ate 5h do proprio dia do
// turno), pra cobrir tanto turno que comeca de noite quanto turno que
// comeca de madrugada ainda dentro do periodo noturno.
function segmentNightMinutes(entrada: string, saida: string): number {
  const entradaAbs = toMinutes(entrada);
  const saidaMin = toMinutes(saida);
  const saidaAbs = saidaMin + (saidaMin < entradaAbs ? 24 * 60 : 0);
  return (
    nightOverlapMinutes(entradaAbs, saidaAbs, NIGHT_START_MINUTES, 24 * 60 + NIGHT_END_MINUTES) +
    nightOverlapMinutes(entradaAbs, saidaAbs, NIGHT_START_MINUTES - 24 * 60, NIGHT_END_MINUTES)
  );
}

// 52min30s = 1 "hora noturna" no periodo urbano (22h-5h) — art. 73, §1º CLT
// ("A hora do trabalho noturno sera computada como de 52 minutos e 30
// segundos"). Cada minuto real trabalhado nesse periodo conta como
// 60/52,5 = 8/7 de minuto pra fins de duracao E do calculo do adicional
// (ver src/lib/convencao.ts:nightPremiumCents, que so recebe "minutos" e
// nao sabe da reducao).
const HORA_NOTURNA_REDUZIDA_SEGUNDOS = 52 * 60 + 30;
const NIGHT_MINUTES_FICTA_FACTOR = 3600 / HORA_NOTURNA_REDUZIDA_SEGUNDOS;

// Adicional noturno (art. 73 CLT): minutos noturnos COMPUTADOS (ja com a
// reducao ficta acima aplicada) entre 22h e 5h, descontando o(s)
// intervalo(s) do mesmo jeito que workedMinutes. Confirmado contra o
// extrato oficial de um motorista real (2026-08-18, RH do usuario): 78min
// reais entre 22h-23h18 -> 89,14min computados, diferenca de ~11min que
// batia exatamente com o "Total" oficial do TiqueTaque (que ja aplica essa
// regra) pro mesmo turno. Arredonda pro minuto inteiro antes de retornar —
// o valor alimenta formatHoursMinutes, que faz Math.floor/% e quebra com
// entrada fracionaria.
export function nightMinutes(
  entry: Pick<PontoEntryLike, "clockIn" | "clockOut" | "intervaloInicio" | "intervaloFim" | "punches">
): number {
  const punches = parsePunches(entry.punches);
  let realMinutes = 0;
  if (punches.length > 0) {
    realMinutes = punches.reduce((sum, p) => sum + (p.saida ? segmentNightMinutes(p.entrada, p.saida) : 0), 0);
  } else if (entry.clockOut) {
    realMinutes =
      entry.intervaloInicio && entry.intervaloFim
        ? segmentNightMinutes(entry.clockIn, entry.intervaloInicio) + segmentNightMinutes(entry.intervaloFim, entry.clockOut)
        : segmentNightMinutes(entry.clockIn, entry.clockOut);
  }
  return Math.round(realMinutes * NIGHT_MINUTES_FICTA_FACTOR);
}

export type EscalaLike = { driverId: string; date: Date };
export type Absence = { driverId: string; date: Date };

// Tolerancia antes de considerar atraso/saida antecipada uma ocorrencia real
// (evita marcar diferencas de 1-2min de imprecisao do relogio como
// atraso) — nao tem base legal especifica, e uma margem operacional comum.
export const PONTUALIDADE_TOLERANCIA_MINUTOS = 10;
// Acima disso, a diferenca provavelmente veio de erro de fuso/virada de dia
// entre o horario programado e o horario real (ex.: turno da escala termina
// as 23h mas o motorista bateu 00:22 do dia seguinte — isso e ATRASO na
// saida, nao saida antecipada) — descarta em vez de reportar um numero
// absurdo.
const PONTUALIDADE_MAX_PLAUSIVEL_MINUTOS = 12 * 60;

export type EscalaScheduleLike = { driverId: string; date: Date; startTime: string; endTime: string };

export type LatenessEvent = {
  driverId: string;
  date: Date;
  scheduledStart: string;
  actualStart: string;
  lateMinutes: number;
};

export type EarlyDepartureEvent = {
  driverId: string;
  date: Date;
  scheduledEnd: string;
  actualEnd: string;
  earlyMinutes: number;
};

// Atraso: horario real de entrada (TimeClockEntry.clockIn) depois do
// horario programado na Escala do mesmo dia, alem da tolerancia.
export function findLatenessEvents(
  escalas: EscalaScheduleLike[],
  entries: PontoEntryLike[]
): LatenessEvent[] {
  const entryByKey = new Map<string, PontoEntryLike>();
  for (const entry of entries) entryByKey.set(localDayKey(entry.driverId, entry.date), entry);

  const events: LatenessEvent[] = [];
  for (const escala of escalas) {
    const entry = entryByKey.get(localDayKey(escala.driverId, escala.date));
    if (!entry) continue;
    const lateMinutes = toMinutes(entry.clockIn) - toMinutes(escala.startTime);
    if (lateMinutes > PONTUALIDADE_TOLERANCIA_MINUTOS && lateMinutes <= PONTUALIDADE_MAX_PLAUSIVEL_MINUTOS) {
      events.push({ driverId: escala.driverId, date: escala.date, scheduledStart: escala.startTime, actualStart: entry.clockIn, lateMinutes });
    }
  }
  return events;
}

// Saida antecipada: horario real de saida (TimeClockEntry.clockOut) antes do
// horario programado na Escala do mesmo dia, alem da tolerancia. So conta
// turno ja fechado (clockOut preenchido) — turno aberto nao e "saida cedo",
// e ausencia de registro.
export function findEarlyDepartureEvents(
  escalas: EscalaScheduleLike[],
  entries: PontoEntryLike[]
): EarlyDepartureEvent[] {
  const entryByKey = new Map<string, PontoEntryLike>();
  for (const entry of entries) entryByKey.set(localDayKey(entry.driverId, entry.date), entry);

  const events: EarlyDepartureEvent[] = [];
  for (const escala of escalas) {
    const entry = entryByKey.get(localDayKey(escala.driverId, escala.date));
    if (!entry || !entry.clockOut) continue;
    const earlyMinutes = toMinutes(escala.endTime) - toMinutes(entry.clockOut);
    if (earlyMinutes > PONTUALIDADE_TOLERANCIA_MINUTOS && earlyMinutes <= PONTUALIDADE_MAX_PLAUSIVEL_MINUTOS) {
      events.push({ driverId: escala.driverId, date: escala.date, scheduledEnd: escala.endTime, actualEnd: entry.clockOut, earlyMinutes });
    }
  }
  return events;
}

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
