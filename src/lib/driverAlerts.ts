import { differenceInCalendarDays } from "date-fns";

export type CnhAlertLevel = "vencida" | "vence_em_breve" | "ok" | "pendente";

const WARNING_WINDOW_DAYS = 30;

// "pendente" (sem CNH cadastrada, ex.: motorista importado do TiqueTaque)
// e distinto de "vencida" — precisa de cadastro, nao de renovacao.
export function cnhAlertLevel(cnhExpiration: Date | null, now = new Date()): CnhAlertLevel {
  if (!cnhExpiration) return "pendente";
  const days = differenceInCalendarDays(cnhExpiration, now);
  if (days < 0) return "vencida";
  if (days <= WARNING_WINDOW_DAYS) return "vence_em_breve";
  return "ok";
}

export function daysUntil(cnhExpiration: Date, now = new Date()): number {
  return differenceInCalendarDays(cnhExpiration, now);
}
