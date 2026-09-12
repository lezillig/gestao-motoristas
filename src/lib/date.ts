// Inputs type="date" enviam "YYYY-MM-DD" sem fuso. `new Date(string)` (e por
// extensao z.coerce.date()) trata esse formato como meia-noite UTC, o que em
// fusos negativos (Brasil, UTC-3) volta um dia no calendario local — bug real
// verificado neste projeto. Este parser sempre le como meia-noite local.
export function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(NaN);
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

// Combina um input type="date" com um input type="time" num Date local unico
// (ex: check-in de utilizacao de veiculo). Mesma logica de fuso do
// parseLocalDate acima.
export function combineLocalDateTime(dateValue: string, timeValue: string): Date {
  const date = parseLocalDate(dateValue);
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!match || Number.isNaN(date.getTime())) return new Date(NaN);
  const [, h, min] = match;
  date.setHours(Number(h), Number(min), 0, 0);
  return date;
}

// America/Sao_Paulo e UTC-3 o ano inteiro desde o fim do horario de verao no
// Brasil (extinto em 2019) — deslocamento fixo, sem precisar de biblioteca
// de fuso horario. Usado pra converter um instante UTC (ex.: start_datetime/
// end_datetime do SIAT, sempre ISO com "Z") em data+hora LOCAL, no mesmo
// formato (AAAA-MM-DD / HH:mm) que o resto do app usa pra Escala/ponto —
// nunca usa getHours()/getDate() locais do processo Node aqui de proposito
// (o timezone do processo na Vercel nao e garantido ser America/Sao_Paulo),
// so getUTC* depois de aplicar o deslocamento manualmente.
const BRAZIL_UTC_OFFSET_HOURS = 3;

export function utcInstantToLocalParts(iso: string): { dateISO: string; time: string } | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const shifted = new Date(instant.getTime() - BRAZIL_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return { dateISO: `${y}-${m}-${d}`, time: `${hh}:${mm}` };
}

// Instante UTC exato da meia-noite em Brasilia de "hoje + daysFromToday" —
// pra filtrar colunas de TIMESTAMP REAL (ex.: VehicleTrip.startAt,
// FuelTransaction.dataHora) por dia-calendario brasileiro. Nunca usa a
// hora local do PROCESSO (a Vercel roda em UTC, nao Brasilia) — sem isso,
// um evento real do fim da noite em Brasilia (ex. 23h30 BRT = 02h30 UTC do
// dia seguinte) cai no dia UTC errado e o dia certo aparece como "sem
// dado" mesmo tendo dado (confirmado real, 2026-09-09, no check de
// lacunas da Ituran — ver lib/integrationGaps.ts). Diferente de
// Escala.date/TimeClockEntry.date, que ja sao um "rotulo" de data sem
// hora real (ver parseLocalDate) e nao sofrem desse problema.
export function brazilMidnightUtc(daysFromToday = 0): Date {
  const shifted = new Date(Date.now() - BRAZIL_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate() + daysFromToday;
  return new Date(Date.UTC(y, m, d) + BRAZIL_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

// "Rotulo" de data (meia-noite do PROCESSO, igual ao que parseLocalDate
// grava em Escala.date/TimeClockEntry.date) do dia-calendario de Brasilia
// de hoje + daysFromToday. Diferente de brazilMidnightUtc (instante real,
// pra coluna TIMESTAMP): aqui o resultado precisa bater com o rotulo
// gravado. Sem isso, `subDays(new Date(), 1)` as 14h UTC vira "ontem 14h" e
// um filtro gte/lt em cima disso pega o rotulo de HOJE (dia ainda
// incompleto) em vez do de ontem — bug real em /utilizacao/auditoria/
// excecoes (2026-09-11), que mostrava "hoje" rotulado como "ontem".
export function brazilDayLabel(daysFromToday = 0): Date {
  const parts = utcInstantToLocalParts(new Date(Date.now() + daysFromToday * 86_400_000).toISOString())!;
  return parseLocalDate(parts.dateISO);
}

// Inverso de utcInstantToLocalParts: converte um "yyyy-MM-dd" (rotulo de
// dia-calendario de Brasilia, ex.: um dia que o usuario escolheu
// reimportar em Integrações) no instante UTC exato da meia-noite REAL em
// Brasilia desse dia — pra montar o intervalo de busca de uma API externa
// (Ituran, Sofit) que espera limites em UTC.
export function brazilDateStringToUtc(dateISO: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!match) return new Date(NaN);
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)) + BRAZIL_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

// Como brazilDateStringToUtc, mas com hora:minuto tambem — instante UTC
// exato de um horario em Brasilia (ex.: horaInfracao de uma multa) pra
// comparar contra um TIMESTAMP REAL independente (VehicleTrip.startAt/
// endAt, da Ituran). Diferente de combineLocalDateTime (usado pra
// VehicleUsageLog.checkInAt): aquele guarda a hora BRT "cru" como se fosse
// UTC, uma convencao interna deste app onde os dois lados da comparacao
// usam o mesmo deslocamento e por isso se cancelam — mas a Ituran nao seguiu
// essa convencao (manda timestamp real, ja em UTC de verdade), entao
// cruzar contra ela exige a conversao correta, nao a convencao interna.
export function brazilDateTimeToUtc(dateISO: string, time: string): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return new Date(NaN);
  const [, y, m, d] = dateMatch;
  const [, hh, mm] = timeMatch;
  return new Date(
    Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)) + BRAZIL_UTC_OFFSET_HOURS * 60 * 60 * 1000
  );
}
