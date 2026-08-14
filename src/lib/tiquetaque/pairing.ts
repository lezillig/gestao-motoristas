import type { TiqueTaqueDayEntry, TiqueTaquePunchPair } from "./types";

type RawPunch = { time: string; approved: boolean };

// Agrupa batidas avulsas (formato "AAAA-MM-DDTHH:mm", ja no fuso local do
// funcionario) por dia e as pareia em entrada/saida. So usa batidas
// aprovadas — uma pendente de aprovacao no TiqueTaque nao deveria virar um
// registro de ponto confirmado no nosso sistema.
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

    // Pareia cronologicamente, alternando entrada/saida (1a=entrada,
    // 2a=saida, 3a=entrada, ...) — um dia pode ter mais de 1 par (mais de
    // uma pausa), o que os antigos campos unicos intervaloInicio/Fim nao
    // conseguiam representar. A API do TiqueTaque nao rotula cada batida
    // como entrada/saida (o campo "type" da batida e so o metodo de
    // registro, ex. "app"), entao paridade por ordem cronologica e a unica
    // informacao disponivel — confirmado comparando contra um extrato real
    // do TiqueTaque, que pareia da mesma forma.
    const pairs: TiqueTaquePunchPair[] = [];
    for (let i = 0; i < sorted.length; i += 2) {
      pairs.push({ entrada: sorted[i], saida: sorted[i + 1] ?? null });
    }
    const lastPair = pairs[pairs.length - 1];

    days.push({
      date,
      clockIn: pairs[0]?.entrada ?? sorted[0],
      clockOut: lastPair?.saida ?? null,
      intervaloInicio: pairs.length > 1 ? pairs[0].saida : null,
      intervaloFim: pairs.length > 1 ? pairs[1].entrada : null,
      pairs,
    });
  }
  return days;
}
