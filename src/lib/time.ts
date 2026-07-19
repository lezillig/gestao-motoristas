export function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function timeRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

// Duracao entre dois horarios HH:mm no mesmo dia. Se o fim for menor que o
// inicio, assume virada de meia-noite (turno noturno) e soma 24h.
export function durationMinutes(start: string, end: string) {
  let minutes = toMinutes(end) - toMinutes(start);
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}

export function formatHoursMinutes(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${m > 0 ? `${m.toString().padStart(2, "0")}` : ""}`;
}
