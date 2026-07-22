import type { TiqueTaqueDayEntry } from "./types";

type RawPunch = { time: string; approved: boolean };

// Agrupa batidas avulsas (formato "AAAA-MM-DDTHH:mm", ja no fuso local do
// funcionario) por dia e as pareia em entrada/saida + intervalo. So usa
// batidas aprovadas — uma pendente de aprovacao no TiqueTaque nao deveria
// virar um registro de ponto confirmado no nosso sistema.
export function pairPunchesIntoDays(punches: RawPunch[]): TiqueTaqueDayEntry[] {
  const byDate = new Map<string, string[]>();
  for (const punch of punches) {
    if (!punch.approved) continue;
    const [date, hhmm] = punch.time.split("T");
    if (!date || !hhmm) continue;
    const list = byDate.get(date) ?? [];
    list.push(hhmm.slice(0, 5));
    byDate.set(date, list);
  }

  const days: TiqueTaqueDayEntry[] = [];
  for (const [date, times] of byDate) {
    const sorted = [...times].sort();
    days.push({
      date,
      clockIn: sorted[0],
      clockOut: sorted.length >= 2 ? sorted[sorted.length - 1] : null,
      intervaloInicio: sorted.length === 4 ? sorted[1] : null,
      intervaloFim: sorted.length === 4 ? sorted[2] : null,
    });
  }
  return days;
}
