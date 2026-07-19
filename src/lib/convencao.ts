import { STANDARD_DAILY_MINUTES } from "@/lib/pontoCompliance";

export function isVigente(
  convencao: { vigenciaInicio: Date; vigenciaFim: Date | null },
  today = new Date()
) {
  return convencao.vigenciaInicio <= today && (!convencao.vigenciaFim || today <= convencao.vigenciaFim);
}

type DriverWithConvencoes = {
  sindicato: {
    nome: string;
    convencoes: {
      vigenciaInicio: Date;
      vigenciaFim: Date | null;
      regras: { tipo: string; valorNumerico: number | null }[];
    }[];
  } | null;
};

// Jornada normal do motorista: 8h por lei, a menos que a CCT vigente do seu
// sindicato tenha uma regra JORNADA_DIARIA propria (valorNumerico em horas).
export function driverDailyLimitMinutes(
  driver: DriverWithConvencoes,
  today = new Date()
): { minutes: number; source: string | null } {
  if (!driver.sindicato) return { minutes: STANDARD_DAILY_MINUTES, source: null };

  for (const convencao of driver.sindicato.convencoes) {
    if (!isVigente(convencao, today)) continue;
    const regra = convencao.regras.find((r) => r.tipo === "JORNADA_DIARIA" && r.valorNumerico != null);
    if (regra) return { minutes: regra.valorNumerico! * 60, source: driver.sindicato.nome };
  }
  return { minutes: STANDARD_DAILY_MINUTES, source: null };
}

export const TIPO_REGRA_LABELS: Record<string, string> = {
  JORNADA_DIARIA: "Jornada diária normal",
  HORA_EXTRA: "Adicional de hora extra",
  BANCO_HORAS: "Limite de banco de horas",
  ADICIONAL_NOTURNO: "Adicional noturno",
  INTERVALO: "Intervalo mínimo",
  JORNADA_12X36: "Regime 12x36",
  OUTRO: "Outra regra",
};

export const TIPO_REGRA_UNIDADE: Record<string, string> = {
  JORNADA_DIARIA: "horas",
  HORA_EXTRA: "% adicional",
  BANCO_HORAS: "horas",
  ADICIONAL_NOTURNO: "% adicional",
  INTERVALO: "minutos",
  JORNADA_12X36: "—",
  OUTRO: "—",
};
