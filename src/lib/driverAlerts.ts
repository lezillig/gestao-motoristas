import { differenceInCalendarDays } from "date-fns";

export type CnhAlertLevel = "vencida" | "vence_em_breve" | "ok";

const WARNING_WINDOW_DAYS = 30;

export function cnhAlertLevel(cnhExpiration: Date, now = new Date()): CnhAlertLevel {
  const days = differenceInCalendarDays(cnhExpiration, now);
  if (days < 0) return "vencida";
  if (days <= WARNING_WINDOW_DAYS) return "vence_em_breve";
  return "ok";
}

export function daysUntil(cnhExpiration: Date, now = new Date()): number {
  return differenceInCalendarDays(cnhExpiration, now);
}
