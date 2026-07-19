import { STANDARD_DAILY_MINUTES } from "@/lib/pontoCompliance";

export function isVigente(
  convencao: { vigenciaInicio: Date; vigenciaFim: Date | null },
  today = new Date()
) {
  return convencao.vigenciaInicio <= today && (!convencao.vigenciaFim || today <= convencao.vigenciaFim);
}

type ConvencaoLike = {
  tipo: string;
  vigenciaInicio: Date;
  vigenciaFim: Date | null;
  regras: { tipo: string; valorNumerico: number | null; descricao: string | null }[];
};

type DriverWithConvencoes = {
  regimeHoras?: string | null;
  sindicato: {
    nome: string;
    convencoes: ConvencaoLike[];
  } | null;
};

export type RegraResolvida = {
  valorNumerico: number | null;
  descricao: string | null;
  fonte: { tipo: "ACT" | "CCT"; nome: string } | null;
};

// Resolve uma regra estruturada (JORNADA_DIARIA, JORNADA_12X36, BANCO_HORAS,
// etc.) considerando a precedencia entre Acordo Coletivo (ACT, negociado
// direto com esta empresa) e Convencao Coletiva (CCT, da categoria): o ACT
// vigente vence sempre que existir uma regra do tipo pedido, mesmo que a CCT
// tambem tenha uma (art. 620 CLT, Lei 13.467/2017). So cai para a CCT se o
// ACT nao existir ou nao tratar daquele tipo de regra.
export function resolveRegra(
  driver: DriverWithConvencoes,
  tipoRegra: string,
  today = new Date()
): RegraResolvida {
  if (!driver.sindicato) return { valorNumerico: null, descricao: null, fonte: null };

  const vigentes = driver.sindicato.convencoes.filter((c) => isVigente(c, today));
  const porTipo = (tipo: "ACT" | "CCT") =>
    vigentes
      .filter((c) => c.tipo === tipo)
      .map((c) => c.regras.find((r) => r.tipo === tipoRegra))
      .find((r) => r != null);

  const act = porTipo("ACT");
  if (act) return { valorNumerico: act.valorNumerico, descricao: act.descricao, fonte: { tipo: "ACT", nome: driver.sindicato.nome } };

  const cct = porTipo("CCT");
  if (cct) return { valorNumerico: cct.valorNumerico, descricao: cct.descricao, fonte: { tipo: "CCT", nome: driver.sindicato.nome } };

  return { valorNumerico: null, descricao: null, fonte: null };
}

// Jornada normal do motorista: 8h por lei, a menos que o ACT/CCT vigente do
// seu sindicato tenha uma regra JORNADA_DIARIA propria (valorNumerico em
// horas).
export function driverDailyLimitMinutes(
  driver: DriverWithConvencoes,
  today = new Date()
): { minutes: number; source: string | null } {
  const regra = resolveRegra(driver, "JORNADA_DIARIA", today);
  if (regra.valorNumerico != null && regra.fonte) {
    return { minutes: regra.valorNumerico * 60, source: regra.fonte.nome };
  }
  return { minutes: STANDARD_DAILY_MINUTES, source: null };
}

// Indica se o motorista esta em regime 12x36 vigente. Precedencia: override
// individual do motorista (regimeHoras, art. 59-A CLT permite 12x36 por
// acordo individual) > ACT vigente > CCT vigente. Quando ativo, os checks de
// jornada/interjornada padrao (8h/11h) nao se aplicam. `individual: true`
// sinaliza que a fonte e um acordo do proprio motorista, nao a convencao do
// sindicato — usado para categorizar o alerta corretamente na analise.
export function driverRegime12x36(
  driver: DriverWithConvencoes,
  today = new Date()
): { ativo: boolean; source: string | null; individual: boolean } {
  if (driver.regimeHoras === "DOZE_X_TRINTA_SEIS") {
    return { ativo: true, source: "acordo individual (art. 59-A CLT)", individual: true };
  }
  if (driver.regimeHoras === "PADRAO") {
    return { ativo: false, source: null, individual: true };
  }
  const regra = resolveRegra(driver, "JORNADA_12X36", today);
  return { ativo: regra.fonte !== null, source: regra.fonte?.nome ?? null, individual: false };
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
