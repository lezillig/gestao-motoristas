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
