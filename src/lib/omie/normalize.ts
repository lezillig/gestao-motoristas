// Conversões entre o formato cru da API do Omie e o do sistema.

/** CNPJ/CPF só dígitos. Devolve null pra string vazia/inválida. */
export function normalizeCnpjCpf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  // 11 = CPF, 14 = CNPJ. Qualquer outro tamanho é lixo de cadastro (campo
  // livre preenchido errado no ERP) e vira null em vez de virar chave de
  // casamento — casar clientes por um documento truncado é pior que não casar.
  if (digits.length !== 11 && digits.length !== 14) return null;
  return digits;
}

/** Texto do Omie: aparado, e vazio vira null (a API devolve "" em vez de omitir). */
export function normalizeTexto(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof raw === "number") return String(raw);
  return null;
}

/**
 * Datas do Omie vêm como "dd/mm/aaaa" (não ISO). Convertidas para meio-dia
 * LOCAL, não meia-noite UTC: o resto do schema guarda dia-cheio como DateTime,
 * e meia-noite UTC vira o dia anterior em qualquer fuso negativo (Brasil
 * inteiro) — é o mesmo cuidado já tomado na importação do TiqueTaque.
 */
export function parseDataOmie(raw: unknown): Date | null {
  const texto = normalizeTexto(raw);
  if (!texto) return null;
  const match = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dia, mes, ano] = match;
  const date = new Date(Number(ano), Number(mes) - 1, Number(dia), 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Data para o formato que os filtros da API esperam ("dd/mm/aaaa"). */
export function formatDataOmie(date: Date): string {
  const dia = String(date.getDate()).padStart(2, "0");
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${date.getFullYear()}`;
}

/**
 * Valores monetários do Omie vêm como float (ex. 1234.56) — convertidos para
 * centavos inteiros, como o resto do schema (valorCents em FuelTransaction).
 * Math.round e não trunc: 0.1 + 0.2 do lado deles chega como 0.30000000000004
 * e truncar perderia o centavo.
 */
export function valorParaCents(raw: unknown): number | null {
  const numero = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN;
  if (!Number.isFinite(numero)) return null;
  return Math.round(numero * 100);
}

/** Campos booleanos do Omie são "S"/"N". */
export function simNaoParaBoolean(raw: unknown): boolean {
  return typeof raw === "string" && raw.trim().toUpperCase() === "S";
}

/**
 * Chave de comparação de nome de cliente: maiúsculas, sem acento, espaços
 * colapsados e sem sufixo de tipo societário. Usada só como ÚLTIMO recurso no
 * casamento com o cadastro local (o critério bom é CNPJ/CPF) — ver
 * src/lib/omie/sync.ts.
 */
export function chaveNome(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[.,\-/]/g, " ")
    .replace(/\b(LTDA|ME|EPP|EIRELI|S\s?A|SA|SS)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
