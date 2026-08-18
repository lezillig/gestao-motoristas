import type { TiqueTaqueDayEntry, TiqueTaqueLocation, TiqueTaquePunchPair } from "./types";

type RawPunch = { time: string; approved: boolean; location?: TiqueTaqueLocation | null; type?: string | null };

// Nenhum turno real e mais longo que isso — usado como teto de plausibilidade
// pra decidir se duas batidas consecutivas formam um par (ver mais abaixo).
// Maior que qualquer turno real ja visto em dados de producao (o mais longo
// confirmado ficou em ~12h), com folga.
//
// Reduzido de 16h pra 14h (2026-08-18, achado pelo usuario comparando com o
// extrato oficial): um motorista que bate so a ENTRADA e nunca bate a saida
// (turno em aberto de verdade, o proprio TiqueTaque mostra so 1 marcacao
// naquele dia) tinha essa entrada incorretamente pareada com a PRIMEIRA
// marcacao do dia seguinte, porque o intervalo entre as duas (ex.: 21:30 ate
// 12:33 do dia seguinte, 15h03) ainda cabia dentro do teto de 16h — isso
// tambem desalinhava o dia seguinte inteiro (a marcacao "roubada" deixava de
// estar disponivel como a entrada real daquele dia). 14h mantem folga de 2h
// acima do turno mais longo ja confirmado (~12h) e foi testado contra os 4
// casos reais de bug ja investigados nesta sessao sem quebrar nenhum dos que
// já estavam corretos.
const MAX_PLAUSIBLE_SHIFT_MINUTES = 14 * 60;

function minutesBetween(aFull: string, bFull: string): number {
  return (new Date(bFull).getTime() - new Date(aFull).getTime()) / 60000;
}

// Pareia batidas aprovadas em ordem cronologica ABSOLUTA (nao por dia
// calendario) e so DEPOIS agrupa os pares resultantes pelo dia da entrada.
// So usa batidas aprovadas — uma pendente de aprovacao no TiqueTaque nao
// deveria virar um registro de ponto confirmado no nosso sistema.
//
// Bug #1 corrigido aqui (2026-08-16, achado pelo usuario comparando com o
// extrato real de um motorista de turno noturno): a versao antiga agrupava
// as batidas pelo DIA CALENDARIO de cada marca antes de parear. Isso quebra
// qualquer turno que cruza a meia-noite — a saida de madrugada (ex. 00:28)
// cai no dia calendario seguinte ao da entrada (ex. 20:25 do dia anterior),
// entao ela ficava "sobrando" nesse dia seguinte e virava par com a PROXIMA
// entrada daquele mesmo dia — produzindo um "turno" de ~20h que na real e o
// DESCANSO entre dois turnos reais, invertido em horas trabalhadas.
//
// Bug #2 corrigido aqui (mesmo dia, achado reimportando o mes inteiro de
// producao pra varios motoristas de uma vez): pareando TODAS as batidas do
// periodo inteiro em sequencia simples (1a-2a, 3a-4a, ...) sem nenhum
// criterio de plausibilidade, uma UNICA batida a mais em QUALQUER lugar do
// periodo (ex. dupla marcacao por engano, bem comum em 300 motoristas ao
// longo de 7+ meses) desalinha a paridade de TODAS as batidas seguintes,
// para o resto inteiro do periodo — motoristas com turno diurno normal
// (entrada de manha, saida no meio do dia, sem cruzar meia-noite nenhuma)
// comecaram a aparecer com turnos de ~18-20h, misturando a saida de um dia
// com a entrada do dia seguinte. So aceita um par se o intervalo entre as
// duas batidas for plausivel como turno (`MAX_PLAUSIBLE_SHIFT_MINUTES`); do
// contrario, a primeira batida vira um registro isolado (turno em aberto,
// sem saida) e o pareamento recomeca do zero a partir da batida seguinte —
// uma batida extra fica isolada num unico "turno aberto" cosmetico (nao
// entra na soma de horas trabalhadas, que so soma pares com saida), sem
// arrastar erro pros dias seguintes. Verificado com o extrato real de um
// motorista com uma marcacao duplicada no meio do mes: o pareamento erra so
// aquele dia e volta a bater com a producao no dia seguinte.
//
// Bug #3 corrigido aqui (2026-08-18, achado pelo usuario comparando com o
// extrato oficial de 2 motoristas cujo total no nosso sistema passava de
// 24h/dia — impossivel). Causa real, confirmada chamando a API ao vivo:
// o TiqueTaque marca uma batida como invalida com `type: "desconsiderado"`
// (ex.: `justification: "Duplicidade de registro"`, "DUPLICADO") quando
// alguem bate o ponto duas vezes ou um admin invalida a marcacao — mas essa
// batida continua vindo com `approved: true`. O filtro antigo so olhava
// `approved`, entao a batida desconsiderada entrava na sequencia igual a
// uma batida valida e virava uma "entrada" fantasma, desalinhando a
// paridade entrada/saida do dia (mesma classe do Bug #2, mas o gatilho e
// diferente: uma batida marcada como invalida pelo proprio TiqueTaque, nao
// uma marcacao dupla comum). MAX_PLAUSIBLE_SHIFT_MINUTES nao pega esse caso
// porque o par errado formado ainda cai dentro de 16h (plausivel na
// aparencia). Verificado ao vivo pra 2 motoristas reais (AURELIO TAVARES DE
// MELO 21/01/2026, JOSE ANTONIO DA SILVA 05/08/2026): excluir as batidas
// "desconsiderado" faz o pareamento bater exatamente com o extrato oficial
// do TiqueTaque nos dois casos.
export function pairPunchesIntoDays(punches: RawPunch[]): TiqueTaqueDayEntry[] {
  const sorted = punches
    .filter((p) => p.approved && p.type?.trim().toLowerCase() !== "desconsiderado")
    .map((p) => ({ time: p.time, location: p.location ?? null, type: p.type ?? null }))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  const rawPairs: {
    entradaFull: string;
    entradaLocation: TiqueTaqueLocation | null;
    entradaType: string | null;
    saidaFull: string | null;
    saidaLocation: TiqueTaqueLocation | null;
    saidaType: string | null;
  }[] = [];
  let i = 0;
  while (i < sorted.length) {
    const entrada = sorted[i];
    const next = sorted[i + 1];
    if (next && minutesBetween(entrada.time, next.time) <= MAX_PLAUSIBLE_SHIFT_MINUTES) {
      rawPairs.push({
        entradaFull: entrada.time,
        entradaLocation: entrada.location,
        entradaType: entrada.type,
        saidaFull: next.time,
        saidaLocation: next.location,
        saidaType: next.type,
      });
      i += 2;
    } else {
      rawPairs.push({
        entradaFull: entrada.time,
        entradaLocation: entrada.location,
        entradaType: entrada.type,
        saidaFull: null,
        saidaLocation: null,
        saidaType: null,
      });
      i += 1;
    }
  }

  const byDate = new Map<string, TiqueTaquePunchPair[]>();
  for (const { entradaFull, entradaLocation, entradaType, saidaFull, saidaLocation, saidaType } of rawPairs) {
    const [date, entradaHhmm] = entradaFull.split("T");
    if (!date || !entradaHhmm) continue;
    const saidaHhmm = saidaFull ? saidaFull.split("T")[1] : null;

    const list = byDate.get(date) ?? [];
    list.push({
      entrada: entradaHhmm.slice(0, 5),
      saida: saidaHhmm ? saidaHhmm.slice(0, 5) : null,
      entradaLocation,
      saidaLocation,
      entradaType,
      saidaType,
    });
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
