// Placa brasileira, formato antigo (ABC1234) ou Mercosul (ABC1D23) — extrai
// de dentro de texto livre. Usado tanto pelo sync do SIAT (vehicle_info,
// ex. "177 - van - MASTER V A6 PAS - UPD9C09") quanto pelo cliente da
// Ituran (nickname, ex. "UPN2F99 - FAB / PERNAMBUCANAS - Mahas" — o
// license_plate da API vem vazio, confirmado real).
const PLATE_PATTERN = /\b[A-Z]{3}[0-9][A-Z0-9][0-9]{2}\b/;

export function extractPlate(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.toUpperCase().match(PLATE_PATTERN);
  return match ? match[0] : null;
}
