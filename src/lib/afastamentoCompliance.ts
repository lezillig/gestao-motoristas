import { addYears, differenceInCalendarDays, setYear } from "date-fns";
import { driverDailyLimitMinutes } from "@/lib/convencao";
import { workedMinutes, overtimeMinutes, EXCESSIVE_OVERTIME_MINUTES } from "@/lib/pontoCompliance";
import type { Prisma, TimeClockEntry } from "@prisma/client";

type DriverWithConvencoes = Prisma.DriverGetPayload<{
  include: { sindicato: { include: { convencoes: { include: { regras: true } } } } };
}>;

// So avalia legalidade de folgas cujo texto (`details`, vindo cru do
// TiqueTaque) reivindica compensar hora extra de outro dia — o unico tipo
// de afastamento com um lastro objetivo pra checar contra os dados de ponto
// (art. 59, §§5º-6º CLT e Sumula 85, IV, TST). Atestado NAO tem checagem
// automatica aqui (dado sensivel de saude, fora de escopo verificar
// "legalidade" so pela frequencia). Ferias em dobro tem checagem propria,
// ver findFeriasVencidas abaixo — precisa de Driver.admissao preenchido.
const COMPENSADA_RE = /(\d{2})\/(\d{2})/;

export type PeriodoFeriasVencido = {
  driverId: string;
  periodoAquisitivoInicio: Date;
  periodoAquisitivoFim: Date;
  prazoConcessivo: Date;
};

// Ferias em dobro (art. 137 CLT): cada periodo aquisitivo (12 meses a partir
// da admissao, ou do fim do periodo aquisitivo anterior) tem mais 12 meses
// de periodo concessivo pra as ferias serem efetivamente gozadas. Se nenhuma
// ferias foi registrada dentro dessa janela de 24 meses, o periodo venceu —
// quando as ferias forem finalmente concedidas, devem ser pagas em dobro.
// So roda pra motoristas com admissao cadastrada (campo opcional, ver
// Driver.admissao) — sem isso, nao ha como calcular o periodo aquisitivo.
export function findFeriasVencidas(
  driverId: string,
  admissao: Date | null,
  feriasStartDates: Date[],
  today = new Date()
): PeriodoFeriasVencido[] {
  if (!admissao) return [];
  const vencidos: PeriodoFeriasVencido[] = [];
  let periodoInicio = admissao;
  // Teto de seguranca (60 anos de periodos) pra nunca rodar em loop infinito
  // por um dado de admissao malformado/futuro.
  for (let i = 0; i < 60; i++) {
    const periodoFim = addYears(periodoInicio, 1);
    const prazoConcessivo = addYears(periodoInicio, 2);
    if (prazoConcessivo > today) break;
    const temFerias = feriasStartDates.some((f) => f >= periodoInicio && f < prazoConcessivo);
    if (!temFerias) {
      vencidos.push({ driverId, periodoAquisitivoInicio: periodoInicio, periodoAquisitivoFim: periodoFim, prazoConcessivo });
    }
    periodoInicio = periodoFim;
  }
  return vencidos;
}

export type FolgaComplianceIssue =
  | { tipo: "SEM_DATA_REFERENCIA" }
  | { tipo: "SEM_REGISTRO_HORAS"; dataReferencia: Date }
  | { tipo: "SEM_HORA_EXTRA"; dataReferencia: Date }
  | { tipo: "HORA_EXTRA_ACIMA_2H"; dataReferencia: Date; overtimeMinutes: number }
  | { tipo: "FORA_DA_MESMA_SEMANA"; dataReferencia: Date; diasDeDiferenca: number };

export type FolgaComplianceResult = {
  dataReferencia: Date | null;
  issues: FolgaComplianceIssue[];
};

// "FOLGA COMPENSADA 02/08" -> data plausivel mais proxima da folga (tenta o
// mesmo ano; se isso cair muito depois da folga, tenta o ano anterior — a
// referencia normalmente e um dia de hora extra ANTERIOR a folga).
export function parseDataReferencia(details: string | null, folgaDate: Date): Date | null {
  if (!details) return null;
  const m = details.match(COMPENSADA_RE);
  if (!m) return null;
  const dia = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;

  const candidata = setYear(new Date(folgaDate.getFullYear(), mes - 1, dia), folgaDate.getFullYear());
  const diffMesmoAno = differenceInCalendarDays(candidata, folgaDate);
  // Se a data no mesmo ano cai mais de 60 dias DEPOIS da folga, e mais
  // provavel que seja do ano anterior (compensacao de hora extra passada).
  if (diffMesmoAno > 60) {
    return setYear(candidata, folgaDate.getFullYear() - 1);
  }
  return candidata;
}

export function checkFolgaCompensada(
  leaveType: string,
  details: string | null,
  folgaDate: Date,
  driver: DriverWithConvencoes,
  entry: TimeClockEntry | undefined
): FolgaComplianceResult | null {
  if (leaveType !== "folga") return null;
  if (!details || !/compensad/i.test(details)) return null;

  const dataReferencia = parseDataReferencia(details, folgaDate);
  if (!dataReferencia) return { dataReferencia: null, issues: [{ tipo: "SEM_DATA_REFERENCIA" }] };

  const issues: FolgaComplianceIssue[] = [];

  const diasDeDiferenca = Math.abs(differenceInCalendarDays(folgaDate, dataReferencia));
  // Sem acordo individual de banco de horas documentado, a compensacao só é
  // presumidamente valida dentro da mesma semana (art. 59, §6º CLT) — alem
  // disso so vale com banco de horas por escrito (§5º, ate 6 meses) ou
  // previsao em ACT/CCT, que este sistema nao tem como confirmar.
  if (diasDeDiferenca > 6) {
    issues.push({ tipo: "FORA_DA_MESMA_SEMANA", dataReferencia, diasDeDiferenca });
  }

  if (!entry) {
    issues.push({ tipo: "SEM_REGISTRO_HORAS", dataReferencia });
    return { dataReferencia, issues };
  }

  const limit = driverDailyLimitMinutes(driver, dataReferencia);
  const worked = workedMinutes(entry);
  const extra = overtimeMinutes(worked, limit.minutes);

  if (extra <= 0) {
    issues.push({ tipo: "SEM_HORA_EXTRA", dataReferencia });
  } else if (extra > EXCESSIVE_OVERTIME_MINUTES) {
    // Sumula 85, IV, TST: hora extra habitualmente acima do limite diario
    // (2h) invalida a compensacao do excedente — o excedente deveria ter
    // sido pago, nao compensado com folga.
    issues.push({ tipo: "HORA_EXTRA_ACIMA_2H", dataReferencia, overtimeMinutes: extra });
  }

  return { dataReferencia, issues };
}

export function folgaIssueLabel(issue: FolgaComplianceIssue): string {
  switch (issue.tipo) {
    case "SEM_DATA_REFERENCIA":
      return "Não foi possível identificar a data de hora extra referenciada no texto.";
    case "SEM_REGISTRO_HORAS":
      return `Sem registro de ponto em ${issue.dataReferencia.toLocaleDateString("pt-BR")} — compensação sem lastro nos dados de ponto.`;
    case "SEM_HORA_EXTRA":
      return `Nenhuma hora extra registrada em ${issue.dataReferencia.toLocaleDateString("pt-BR")} — compensação sem hora extra que a justifique.`;
    case "HORA_EXTRA_ACIMA_2H":
      return `Hora extra de ${issue.dataReferencia.toLocaleDateString("pt-BR")} passou de 2h/dia (Súmula 85, IV, TST) — o excedente deveria ter sido pago, não compensado.`;
    case "FORA_DA_MESMA_SEMANA":
      return `Compensação ${issue.diasDeDiferenca} dia(s) fora da mesma semana — só é válida com acordo individual de banco de horas por escrito (art. 59, §§5º-6º CLT); confirme se esse acordo existe.`;
  }
}
