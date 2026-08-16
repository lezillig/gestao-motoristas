import { differenceInCalendarDays } from "date-fns";

export type CnhAlertLevel = "vencida" | "vence_em_breve" | "ok" | "pendente" | "nao_aplicavel";

const WARNING_WINDOW_DAYS = 30;

// Desde que o import do TiqueTaque passou a trazer TODOS os funcionarios
// (nao so quem dirige), precisa distinguir quem realmente precisa de CNH —
// sem isso, um funcionario administrativo importado apareceria com "CNH
// pendente" indevidamente. `funcao` vem cru do TiqueTaque (contract_data.
// job_role), sem padronizacao alem de trim — cadastro manual sem cargo
// preenchido (funcao null) assume que precisa de CNH, preservando o
// comportamento anterior (motorista cadastrado a mao sempre precisou).
export function requiresCnh(funcao: string | null): boolean {
  if (!funcao) return true;
  const normalized = funcao.toLowerCase();
  return normalized.includes("motorista") || normalized.includes("condutor");
}

// "pendente" (sem CNH cadastrada, ex.: motorista importado do TiqueTaque)
// e distinto de "vencida" — precisa de cadastro, nao de renovacao.
// "nao_aplicavel": cargo nao envolve dirigir, CNH nunca sera exigida.
export function cnhAlertLevel(
  cnhExpiration: Date | null,
  funcao: string | null,
  now = new Date()
): CnhAlertLevel {
  if (!requiresCnh(funcao)) return "nao_aplicavel";
  if (!cnhExpiration) return "pendente";
  const days = differenceInCalendarDays(cnhExpiration, now);
  if (days < 0) return "vencida";
  if (days <= WARNING_WINDOW_DAYS) return "vence_em_breve";
  return "ok";
}

export function daysUntil(cnhExpiration: Date, now = new Date()): number {
  return differenceInCalendarDays(cnhExpiration, now);
}
