import { addDays, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { prisma } from "@/lib/prisma";
import {
  workedMinutes,
  overtimeMinutes,
  REGIME_12X36_WORK_MINUTES,
  REGIME_12X36_REST_MINUTES,
  MIN_INTERJORNADA_MINUTES,
  STANDARD_DAILY_MINUTES,
  findInterjornadaViolations,
  findMissingIntervalViolations,
  findMissingWeeklyRestViolations,
} from "@/lib/pontoCompliance";
import { driverDailyLimitMinutes, driverRegime12x36, resolveRegra, HORA_EXTRA_PERCENTUAL_MINIMO } from "@/lib/convencao";

// Estimativa de exposicao financeira (nao calculo pericial): converte
// violacoes ja detectadas pelos outros modulos (pontoCompliance.ts,
// jurisprudencia.ts) num valor em R$, acumulado por motorista/empresa ao
// longo de uma janela movel de meses. Objetivo e apontar TENDENCIA pra
// decisao (esta subindo? qual motorista/tipo concentra o risco?), nao
// substituir um calculo trabalhista formal — cada formula abaixo e uma
// simplificacao documentada, e a UI deixa isso explicito.
export const PASSIVO_WINDOW_MONTHS = 6;

// Mesmos limiares do check de supressao habitual de hora extra (Sumula 291)
// em src/lib/jurisprudencia.ts — nao importados de la (sao privados aquele
// modulo, que e uma camada so de anotacao/rotulo, sem os minutos brutos que
// o calculo monetario aqui precisa) mas mantidos em sincronia de proposito.
const HABITUAL_MONTHLY_OVERTIME_MINUTES = 10 * 60;
const SUPPRESSED_MONTHLY_OVERTIME_MINUTES = 2 * 60;

// Minutos de intervalo presumidos quando o registro nao tem intervalo
// nenhum (turno >=6h): minimo legal do art. 71 CLT (1h) — o sistema so sabe
// que faltou registro, nao a duracao real que deveria ter sido concedida.
const PRESUMED_MISSING_INTERVAL_MINUTES = 60;

// Indenizacao por intervalo/interjornada nao usufruidos: por analogia ao
// adicional de hora extra (jurisprudencia majoritaria pos-Reforma de 2017,
// natureza indenizatoria sobre o periodo suprimido).
const INDEMNITY_PERCENTUAL = 0.5;

export type PassivoTipo = "sumula291" | "intervalo" | "interjornada" | "dsr";

export const PASSIVO_TIPO_LABELS: Record<PassivoTipo, string> = {
  sumula291: "Súmula 291 (supressão de hora extra)",
  intervalo: "Intervalo intrajornada não usufruído",
  interjornada: "Interjornada insuficiente",
  dsr: "Descanso semanal não concedido",
};

export type DriverMonthPassivo = {
  driverId: string;
  driverName: string;
  // PASSIVO_WINDOW_MONTHS posicoes, mais antigo -> mais recente.
  monthlyCents: number[];
  byTypeMonthlyCents: Record<PassivoTipo, number[]>;
  totalCents: number;
};

export type PassivoTrendPoint = {
  monthKey: string;
  label: string;
  totalCents: number;
  byType: Record<PassivoTipo, number>;
};

export type PassivoReport = {
  monthKeys: string[];
  trend: PassivoTrendPoint[];
  drivers: DriverMonthPassivo[];
  totalCents: number;
  byTypeCents: Record<PassivoTipo, number>;
  driversWithoutValorHora: number;
};

// `windowEndExclusive`: primeiro dia do mes SEGUINTE ao ultimo mes da
// janela (ex.: pra incluir ate agosto/2026, passar 01/09/2026).
export async function buildPassivoReport(
  companyId: string,
  windowEndExclusive: Date
): Promise<PassivoReport> {
  const windowStart = startOfMonth(subMonths(windowEndExclusive, PASSIVO_WINDOW_MONTHS));
  // 7 dias antes da janela: mesmo lookback ja usado em /ponto/analise pra
  // checagem de interjornada/DSR cruzando a borda do primeiro mes.
  const fetchStart = addDays(windowStart, -7);

  const [drivers, entries] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId, active: true },
      orderBy: { name: "asc" },
      include: { sindicato: { include: { convencoes: { include: { regras: true } } } } },
    }),
    prisma.timeClockEntry.findMany({
      where: { companyId, date: { gte: fetchStart, lt: windowEndExclusive } },
    }),
  ]);

  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const dailyLimitByDriver = new Map(drivers.map((d) => [d.id, driverDailyLimitMinutes(d)]));
  const regime12x36ByDriver = new Map(drivers.map((d) => [d.id, driverRegime12x36(d)]));
  const escalaSemanalByDriver = new Map(drivers.map((d) => [d.id, d.escalaSemanal]));

  const monthKeys: string[] = [];
  for (let i = PASSIVO_WINDOW_MONTHS; i >= 1; i--) monthKeys.push(format(subMonths(windowEndExclusive, i), "yyyy-MM"));
  const monthIndexOf = (d: Date) => monthKeys.indexOf(format(d, "yyyy-MM"));

  const entriesInWindow = entries.filter((e) => e.date >= windowStart);
  const entryById = new Map(entries.map((e) => [e.id, e]));

  // Hora extra por motorista/mes (so pra alimentar Sumula 291 abaixo) —
  // inclui os meses da janela inteira, nao o lookback de 7 dias (que nao
  // forma mes completo).
  const overtimeByDriverMonth = new Map<string, number>();
  for (const entry of entriesInWindow) {
    const mi = monthIndexOf(entry.date);
    if (mi < 0) continue;
    const regime = regime12x36ByDriver.get(entry.driverId);
    const limit = dailyLimitByDriver.get(entry.driverId);
    const effectiveLimit = regime?.ativo ? REGIME_12X36_WORK_MINUTES : limit?.minutes;
    const overtime = overtimeMinutes(workedMinutes(entry), effectiveLimit);
    if (overtime <= 0) continue;
    const key = `${entry.driverId}_${monthKeys[mi]}`;
    overtimeByDriverMonth.set(key, (overtimeByDriverMonth.get(key) ?? 0) + overtime);
  }

  const interjornadaViol = findInterjornadaViolations(entries, (id) =>
    regime12x36ByDriver.get(id)?.ativo ? REGIME_12X36_REST_MINUTES : MIN_INTERJORNADA_MINUTES
  );
  const missingIntervalViol = findMissingIntervalViolations(entriesInWindow);
  const missingRestViol = findMissingWeeklyRestViolations(entries, (id) => {
    const escala = escalaSemanalByDriver.get(id);
    if (escala === "SEIS_UM") return 6;
    if (escala === "CINCO_DOIS") return 5;
    return 7;
  });

  const perDriver = new Map<string, DriverMonthPassivo>();
  const getDriver = (id: string): DriverMonthPassivo => {
    let d = perDriver.get(id);
    if (!d) {
      d = {
        driverId: id,
        driverName: driverById.get(id)?.name ?? "—",
        monthlyCents: new Array(PASSIVO_WINDOW_MONTHS).fill(0),
        byTypeMonthlyCents: {
          sumula291: new Array(PASSIVO_WINDOW_MONTHS).fill(0),
          intervalo: new Array(PASSIVO_WINDOW_MONTHS).fill(0),
          interjornada: new Array(PASSIVO_WINDOW_MONTHS).fill(0),
          dsr: new Array(PASSIVO_WINDOW_MONTHS).fill(0),
        },
        totalCents: 0,
      };
      perDriver.set(id, d);
    }
    return d;
  };

  function addCents(driverId: string, mi: number, tipo: PassivoTipo, cents: number) {
    if (mi < 0 || mi >= PASSIVO_WINDOW_MONTHS || cents <= 0) return;
    const d = getDriver(driverId);
    d.byTypeMonthlyCents[tipo][mi] += cents;
    d.monthlyCents[mi] += cents;
    d.totalCents += cents;
  }

  // DSR nao concedido (Sumula 146 TST): trabalho no dia de repouso sem
  // compensacao e pago em dobro — a indenizacao e o valor do 2o pagamento
  // (1 dia de salario), usando a jornada 12x36 do motorista quando vigente.
  for (const v of missingRestViol) {
    const entry = entryById.get(v.entryId);
    const driver = driverById.get(v.driverId);
    if (!entry || !driver?.valorHoraCents) continue;
    const mi = monthIndexOf(entry.date);
    const regime = regime12x36ByDriver.get(v.driverId);
    const dailyMinutes = regime?.ativo ? REGIME_12X36_WORK_MINUTES : (dailyLimitByDriver.get(v.driverId)?.minutes ?? STANDARD_DAILY_MINUTES);
    addCents(v.driverId, mi, "dsr", Math.round((dailyMinutes / 60) * driver.valorHoraCents));
  }

  // Intervalo intrajornada nao usufruido (art. 71 CLT): minutos presumidos
  // (minimo legal, 1h) x valor-hora x 50% (natureza indenizatoria).
  for (const v of missingIntervalViol) {
    const entry = entryById.get(v.entryId);
    const driver = driverById.get(v.driverId);
    if (!entry || !driver?.valorHoraCents) continue;
    const mi = monthIndexOf(entry.date);
    addCents(
      v.driverId,
      mi,
      "intervalo",
      Math.round((PRESUMED_MISSING_INTERVAL_MINUTES / 60) * driver.valorHoraCents * INDEMNITY_PERCENTUAL)
    );
  }

  // Interjornada insuficiente (art. 66/235-C §4º CLT, por analogia
  // indenizada como hora extra): minutos faltantes ate o minimo exigido x
  // valor-hora x 50%.
  for (const v of interjornadaViol) {
    const entry = entryById.get(v.nextEntryId);
    const driver = driverById.get(v.driverId);
    if (!entry || !driver?.valorHoraCents) continue;
    const mi = monthIndexOf(entry.date);
    const regime = regime12x36ByDriver.get(v.driverId);
    const required = regime?.ativo ? REGIME_12X36_REST_MINUTES : MIN_INTERJORNADA_MINUTES;
    const missing = Math.max(0, required - v.gapMinutes);
    addCents(v.driverId, mi, "interjornada", Math.round((missing / 60) * driver.valorHoraCents * INDEMNITY_PERCENTUAL));
  }

  // Sumula 291 (supressao habitual de hora extra): so calculavel a partir
  // do 4o mes da janela pra frente, ja que precisa de 3 meses anteriores
  // completos DENTRO dos dados carregados (a janela nao busca 3 meses a
  // mais so pra cobrir os 3 primeiros meses — ver comentario no topo do
  // arquivo sobre escopo da consulta).
  for (const driver of drivers) {
    if (!driver.valorHoraCents) continue;
    for (let mi = 3; mi < PASSIVO_WINDOW_MONTHS; mi++) {
      const priorMinutes = [mi - 3, mi - 2, mi - 1].map((i) => overtimeByDriverMonth.get(`${driver.id}_${monthKeys[i]}`) ?? 0);
      const currentMinutes = overtimeByDriverMonth.get(`${driver.id}_${monthKeys[mi]}`) ?? 0;
      const habitual = priorMinutes.every((m) => m >= HABITUAL_MONTHLY_OVERTIME_MINUTES);
      const suppressed = currentMinutes < SUPPRESSED_MONTHLY_OVERTIME_MINUTES;
      if (!habitual || !suppressed) continue;

      const avgPrior = priorMinutes.reduce((s, m) => s + m, 0) / 3;
      const suppressedMinutes = Math.max(0, avgPrior - currentMinutes);
      const regra = resolveRegra(driver, "HORA_EXTRA");
      const percentual = regra.valorNumerico ?? HORA_EXTRA_PERCENTUAL_MINIMO;
      addCents(driver.id, mi, "sumula291", Math.round((suppressedMinutes / 60) * driver.valorHoraCents * (1 + percentual / 100)));
    }
  }

  const driversList = [...perDriver.values()].filter((d) => d.totalCents > 0).sort((a, b) => b.totalCents - a.totalCents);
  const driversWithoutValorHora = drivers.filter((d) => !d.valorHoraCents).length;

  const byTypeCents: Record<PassivoTipo, number> = { sumula291: 0, intervalo: 0, interjornada: 0, dsr: 0 };
  const trend: PassivoTrendPoint[] = monthKeys.map((key, mi) => {
    const byType: Record<PassivoTipo, number> = { sumula291: 0, intervalo: 0, interjornada: 0, dsr: 0 };
    let total = 0;
    for (const d of driversList) {
      for (const tipo of Object.keys(byType) as PassivoTipo[]) {
        const cents = d.byTypeMonthlyCents[tipo][mi];
        byType[tipo] += cents;
        byTypeCents[tipo] += cents;
      }
      total += d.monthlyCents[mi];
    }
    return { monthKey: key, label: format(new Date(`${key}-01T00:00:00`), "MMM/yy", { locale: ptBR }), totalCents: total, byType };
  });

  const totalCents = driversList.reduce((s, d) => s + d.totalCents, 0);

  return { monthKeys, trend, drivers: driversList, totalCents, byTypeCents, driversWithoutValorHora };
}
