import { format, addDays, startOfDay } from "date-fns";
import { prisma } from "@/lib/prisma";
import { brazilMidnightUtc, utcInstantToLocalParts } from "@/lib/date";

export type GapCheck = { lastDate: Date | null; missingDays: string[] };

// Verificacao recorrente (toda visita a /integracoes): olha so os ultimos
// 7 dias, ate ONTEM — hoje ainda pode estar incompleto por natureza (mesmo
// raciocinio ja usado no aviso do Ituran em /utilizacao/auditoria: o dia so
// fecha de verdade depois que termina, e o sync do dia roda de madrugada
// no dia seguinte). Rodar 60 dias em toda visita seria caro sem necessidade
// — esse alcance maior fica so no botao de verificacao avulsa (ver
// checkAllGaps60Days abaixo), que o usuario aciona quando quiser, nao
// automaticamente.
export const RECURRING_GAP_WINDOW_DAYS = 7;
export const DEEP_GAP_WINDOW_DAYS = 60;

// Pra Escala.date/TimeClockEntry.date — ja sao um "rotulo" de data sem
// hora real (ver parseLocalDate), entao formatar com o timezone do
// PROCESSO (UTC na Vercel) sempre bate com o dia que foi gravado.
function missingDaysFromDates(dates: Date[], start: Date, endExclusive: Date): string[] {
  const present = new Set(dates.map((d) => format(d, "yyyy-MM-dd")));
  const missing: string[] = [];
  for (let d = start; d < endExclusive; d = addDays(d, 1)) {
    const key = format(d, "yyyy-MM-dd");
    if (!present.has(key)) missing.push(key);
  }
  return missing;
}

// Pra VehicleTrip.startAt/FuelTransaction.dataHora — TIMESTAMP real (nao
// um rotulo de data), entao precisa converter pro dia-calendario de
// Brasilia antes de agrupar (ver brazilMidnightUtc em lib/date.ts pro
// porque). `start`/`endExclusive` aqui ja devem vir de brazilMidnightUtc.
function missingDaysFromTimestamps(dates: Date[], start: Date, endExclusive: Date): string[] {
  const present = new Set(dates.map((d) => utcInstantToLocalParts(d.toISOString())?.dateISO).filter((v): v is string => !!v));
  const missing: string[] = [];
  for (let d = start; d < endExclusive; d = addDays(d, 1)) {
    const key = utcInstantToLocalParts(d.toISOString())!.dateISO;
    if (!present.has(key)) missing.push(key);
  }
  return missing;
}

export async function checkTiqueTaquePontoGaps(companyId: string, days: number): Promise<GapCheck> {
  const today = startOfDay(new Date());
  const windowStart = addDays(today, -days);
  const [last, entries] = await Promise.all([
    prisma.timeClockEntry.findFirst({
      where: { companyId, fonte: { in: ["TIQUETAQUE", "TIQUETAQUE_CSV"] } },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    prisma.timeClockEntry.findMany({
      where: { companyId, fonte: { in: ["TIQUETAQUE", "TIQUETAQUE_CSV"] }, date: { gte: windowStart, lt: today } },
      select: { date: true },
    }),
  ]);
  return {
    lastDate: last?.date ?? null,
    missingDays: missingDaysFromDates(entries.map((e) => e.date), windowStart, today),
  };
}

export async function checkSiatGaps(companyId: string, days: number): Promise<GapCheck> {
  const today = startOfDay(new Date());
  const windowStart = addDays(today, -days);
  const [last, escalas] = await Promise.all([
    prisma.escala.findFirst({
      where: { companyId, fonte: "SIAT" },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    prisma.escala.findMany({
      where: { companyId, fonte: "SIAT", date: { gte: windowStart, lt: today } },
      select: { date: true },
    }),
  ]);
  return {
    lastDate: last?.date ?? null,
    missingDays: missingDaysFromDates(escalas.map((e) => e.date), windowStart, today),
  };
}

export async function checkSofitGaps(companyId: string, days: number): Promise<GapCheck> {
  const today = brazilMidnightUtc(0);
  const windowStart = brazilMidnightUtc(-days);
  const [last, txs] = await Promise.all([
    prisma.fuelTransaction.findFirst({
      where: { companyId },
      orderBy: { dataHora: "desc" },
      select: { dataHora: true },
    }),
    prisma.fuelTransaction.findMany({
      where: { companyId, dataHora: { gte: windowStart, lt: today } },
      select: { dataHora: true },
    }),
  ]);
  return {
    lastDate: last?.dataHora ?? null,
    missingDays: missingDaysFromTimestamps(txs.map((t) => t.dataHora), windowStart, today),
  };
}

export async function checkIturanGaps(companyId: string, days: number): Promise<GapCheck> {
  const today = brazilMidnightUtc(0);
  const windowStart = brazilMidnightUtc(-days);
  const [last, trips] = await Promise.all([
    prisma.vehicleTrip.findFirst({
      where: { companyId },
      orderBy: { startAt: "desc" },
      select: { startAt: true },
    }),
    prisma.vehicleTrip.findMany({
      where: { companyId, startAt: { gte: windowStart, lt: today } },
      select: { startAt: true },
    }),
  ]);
  return {
    lastDate: last?.startAt ?? null,
    missingDays: missingDaysFromTimestamps(trips.map((t) => t.startAt), windowStart, today),
  };
}

export type AllGapChecks = {
  tiquetaquePonto: GapCheck;
  siat: GapCheck;
  sofit: GapCheck;
  ituran: GapCheck;
};

export async function checkAllGaps(companyId: string, days: number): Promise<AllGapChecks> {
  const [tiquetaquePonto, siat, sofit, ituran] = await Promise.all([
    checkTiqueTaquePontoGaps(companyId, days),
    checkSiatGaps(companyId, days),
    checkSofitGaps(companyId, days),
    checkIturanGaps(companyId, days),
  ]);
  return { tiquetaquePonto, siat, sofit, ituran };
}
