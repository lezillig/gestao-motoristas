import { differenceInCalendarDays } from "date-fns";

export type CnhAlertLevel = "vencida" | "vence_em_breve" | "ok" | "pendente" | "nao_aplicavel";

const WARNING_WINDOW_DAYS = 30;

// Departamentos claramente administrativos vindos do TiqueTaque
// (contract_data.department) — confirmado real (2026-09-06): EVANDRO JOSE
// DOS SANTOS (departamento FINANCEIRO, cargo em branco no TiqueTaque
// tambem) aparecia errado como "CNH pendente" so pelo default abaixo. Todo
// motorista real conferido ate agora tem departamento OPERACIONAL ou
// ESCOLAR* — nunca um desses nomes administrativos.
const DEPARTAMENTOS_NAO_OPERACIONAIS = [
  "FINANCEIRO",
  "RH",
  "RECURSOS HUMANOS",
  "ADMINISTRATIVO",
  "COMERCIAL",
  "TI",
  "DIRETORIA",
  "JURIDICO",
  "MARKETING",
  "COMPRAS",
  "CONTABILIDADE",
];

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
// TiqueTaque entrava na lista de "CNH pendente" por engano.
export function requiresCnh(funcao: string | null, departamento?: string | null): boolean {
  if (funcao) {
    const normalized = funcao.toLowerCase();
    return normalized.includes("motorista") || normalized.includes("condutor");
  }
  if (departamento && DEPARTAMENTOS_NAO_OPERACIONAIS.includes(departamento.toUpperCase().trim())) {
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
