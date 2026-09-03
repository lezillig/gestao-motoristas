// Next.js devolve searchParams como string quando a chave aparece 1x na
// query e como string[] quando aparece mais de 1x (caso de filtro com
// multi-selecao, ver ComboboxFilter) — normaliza sempre pra lista.
export function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
