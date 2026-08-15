import type { TiqueTaqueDayEntry, TiqueTaquePunchPair } from "./types";

type RawPunch = { time: string; approved: boolean };

// Pareia TODAS as batidas aprovadas em ordem cronologica ABSOLUTA (nao por
// dia calendario) e so DEPOIS agrupa os pares resultantes pelo dia da
// entrada. So usa batidas aprovadas — uma pendente de aprovacao no
// TiqueTaque nao deveria virar um registro de ponto confirmado no nosso
// sistema.
//
// Bug real corrigido aqui (2026-08-16, achado pelo usuario comparando com o
// extrato real de um motorista de turno noturno): a versao anterior
// agrupava as batidas pelo DIA CALENDARIO de cada marca individual, antes
// de parear. Isso quebra qualquer turno que cruza a meia-noite — a saida de
// madrugada (ex. 00:28) cai no dia calendario seguinte ao da entrada (ex.
// 20:25 do dia anterior), entao ela ficava "sobrando" nesse dia seguinte e
// virava par com a PROXIMA entrada daquele mesmo dia (ex. 20:25, inicio do
// turno seguinte) — produzindo um "turno" de ~20h que na real e o DESCANSO
// entre dois turnos reais, invertido em horas trabalhadas. Pareando primeiro
// (cronologia absoluta, atravessando meia-noite) e so depois decidindo a
// qual dia cada PAR pertence (pelo dia da entrada — mesma convencao do
// extrato nativo do TiqueTaque, confirmado comparando um turno real: entrada
// 28/07 20:25 -> saida 29/07 00:22 aparece no relatorio deles como o turno
// de 28/07), o turno noturno inteiro fica corretamente atribuido a um unico
// dia e `durationMinutes` (que ja soma 24h quando a saida e "menor" que a
// entrada) calcula a duracao certa.
export function pairPunchesIntoDays(punches: RawPunch[]): TiqueTaqueDayEntry[] {
  const sorted = punches
    .filter((p) => p.approved)
    .map((p) => p.time)
    .sort();

  const byDate = new Map<string, TiqueTaquePunchPair[]>();
  for (let i = 0; i < sorted.length; i += 2) {
    const [date, entradaHhmm] = sorted[i].split("T");
    if (!date || !entradaHhmm) continue;
    const saidaFull = sorted[i + 1];
    const saidaHhmm = saidaFull ? saidaFull.split("T")[1] : undefined;

    const list = byDate.get(date) ?? [];
    list.push({ entrada: entradaHhmm.slice(0, 5), saida: saidaHhmm ? saidaHhmm.slice(0, 5) : null });
    byDate.set(date, list);
  }

  const days: TiqueTaqueDayEntry[] = [];
  for (const [date, pairs] of byDate) {
    const lastPair = pairs[pairs.length - 1];
    days.push({
      date,
      clockIn: pairs[0].entrada,
      clockOut: lastPair.saida,
      intervaloInicio: pairs.length > 1 ? pairs[0].saida : null,
      intervaloFim: pairs.length > 1 ? pairs[1].entrada : null,
      pairs,
    });
  }
  return days;
}
