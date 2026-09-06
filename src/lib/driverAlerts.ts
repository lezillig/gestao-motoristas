import { differenceInCalendarDays } from "date-fns";

export type CnhAlertLevel = "vencida" | "vence_em_breve" | "ok" | "pendente" | "nao_aplicavel";

const WARNING_WINDOW_DAYS = 30;

// Maiusculo + sem acento, pra "JURÍDICO" (como o TiqueTaque manda de
// verdade) bater com "JURIDICO" na lista abaixo — sem isso a comparacao
// falhava silenciosamente pra qualquer nome de departamento acentuado.
function normalizeUpper(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Departamentos claramente administrativos vindos do TiqueTaque
// (contract_data.department) — confirmado real (2026-09-06): EVANDRO JOSE
// DOS SANTOS (departamento FINANCEIRO, cargo em branco no TiqueTaque
// tambem) aparecia errado como "CNH pendente" so pelo default abaixo. Todo
// motorista real conferido ate agora tem departamento OPERACIONAL ou
// ESCOLAR* — nunca um desses nomes administrativos. Lista fechada, nao
// aberta — ver comentario da funcao abaixo sobre a limitacao disso.
const DEPARTAMENTOS_NAO_OPERACIONAIS = [
  "FINANCEIRO",
  "RH",
  "RECURSOS HUMANOS",
  "ADMINISTRATIVO",
  "COMERCIAL",
  "TI",
  "TECNOLOGIA DA INFORMACAO",
  "DIRETORIA",
  "JURIDICO",
  "MARKETING",
  "COMPRAS",
  "CONTABILIDADE",
  "SAC",
  "ATENDIMENTO",
  "SUPRIMENTOS",
  "CONTROLADORIA",
  "QUALIDADE",
].map(normalizeUpper);

// Desde que o import do TiqueTaque passou a trazer TODOS os funcionarios
// (nao so quem dirige), precisa distinguir quem realmente precisa de CNH —
// sem isso, um funcionario administrativo importado apareceria com "CNH
// pendente" indevidamente. `funcao` vem cru do TiqueTaque (contract_data.
// job_role), sem padronizacao alem de trim.
//
// Cargo em branco (funcao null) assume que precisa de CNH por padrao,
// preservando o comportamento anterior (motorista cadastrado a mao sempre
// precisou) — EXCETO quando o `departamento` (tambem do TiqueTaque, quando
// disponivel) diz claramente que a pessoa nao e operacional. Sem isso,
// gente do financeiro/RH/administrativo cujo cargo nunca foi preenchido no
// TiqueTaque entrava na lista de "CNH pendente" por engano. Lista fechada
// de departamentos administrativos, nao aberta — um departamento novo que
// a empresa venha a usar (ex. "SUPRIMENTOS") e nao estiver na lista ainda
// reproduz o mesmo bug pra outra pessoa; e uma mitigacao, nao uma garantia.
export function requiresCnh(funcao: string | null, departamento?: string | null): boolean {
  if (funcao) {
    // includes, mas excluindo quem so ACOMPANHA o motorista — confirmado
    // real (2026-09-06): "AJUDANTE DE MOTORISTA" nao dirige, mas contem a
    // palavra "motorista" no cargo. Um startsWith puro corrigia esse caso
    // mas arriscava um falso negativo pro lado oposto (cargo real com
    // prefixo, ex. "SEGUNDO MOTORISTA" ou um codigo de RH na frente) —
    // excluir pelo sinal negativo (ajudante/auxiliar) e mais robusto que
    // exigir uma posicao fixa no texto.
    const normalized = normalizeUpper(funcao);
    const ehMotoristaOuCondutor = normalized.includes("MOTORISTA") || normalized.includes("CONDUTOR");
    const eApenasAjudanteOuAuxiliar = normalized.includes("AJUDANTE") || normalized.includes("AUXILIAR");
    return ehMotoristaOuCondutor && !eApenasAjudanteOuAuxiliar;
  }
  if (departamento && DEPARTAMENTOS_NAO_OPERACIONAIS.includes(normalizeUpper(departamento))) {
    return false;
  }
  return true;
}

// "pendente" (sem CNH cadastrada, ex.: motorista importado do TiqueTaque)
// e distinto de "vencida" — precisa de cadastro, nao de renovacao.
// "nao_aplicavel": cargo nao envolve dirigir, CNH nunca sera exigida.
export function cnhAlertLevel(
  cnhExpiration: Date | null,
  funcao: string | null,
  departamento?: string | null,
  now: Date = new Date()
): CnhAlertLevel {
  if (!requiresCnh(funcao, departamento)) return "nao_aplicavel";
  if (!cnhExpiration) return "pendente";
  const days = differenceInCalendarDays(cnhExpiration, now);
  if (days < 0) return "vencida";
  if (days <= WARNING_WINDOW_DAYS) return "vence_em_breve";
  return "ok";
}

export function daysUntil(cnhExpiration: Date, now = new Date()): number {
  return differenceInCalendarDays(cnhExpiration, now);
}
