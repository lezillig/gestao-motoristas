import { startOfMonth, startOfWeek } from "date-fns";
import { parseLocalDate, brazilDayLabel } from "@/lib/date";

// Leitura defensiva de searchParams de data: valor fora do formato (ou data
// inexistente) cai no padrao em vez de virar Invalid Date e derrubar a pagina
// com RangeError/erro do Prisma. Padrao sempre ancorado no dia-calendario de
// Brasilia (brazilDayLabel), nao no relogio UTC do processo.

const MES_RE = /^\d{4}-\d{2}$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function valida(d: Date): Date | null {
  return Number.isNaN(d.getTime()) ? null : d;
}

// "yyyy-MM" -> primeiro dia do mes (rotulo local). Padrao: mes atual.
export function mesParam(v: string | undefined, padrao: Date = brazilDayLabel(0)): Date {
  const d = v && MES_RE.test(v) ? valida(parseLocalDate(`${v}-01`)) : null;
  return startOfMonth(d ?? padrao);
}

// "yyyy-MM-dd" -> rotulo local do dia. Padrao configuravel (null = sem filtro).
export function dataParam(v: string | undefined): Date | null;
export function dataParam(v: string | undefined, padrao: Date): Date;
export function dataParam(v: string | undefined, padrao?: Date): Date | null {
  const d = v && DATA_RE.test(v) ? valida(parseLocalDate(v)) : null;
  return d ?? padrao ?? null;
}

// "yyyy-MM-dd" -> inicio da semana que contem o dia. Padrao: semana atual.
export function semanaParam(v: string | undefined, weekStartsOn: 0 | 1, padrao: Date = brazilDayLabel(0)): Date {
  return startOfWeek(dataParam(v, padrao), { weekStartsOn });
}

// Ano inteiro entre 2000 e ano atual + 1. Padrao: ano atual (Brasilia).
export function anoParam(v: string | undefined): number {
  const atual = brazilDayLabel(0).getFullYear();
  const n = v && /^\d{4}$/.test(v) ? Number(v) : NaN;
  return n >= 2000 && n <= atual + 1 ? n : atual;
}
