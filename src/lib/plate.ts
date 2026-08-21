// Placa brasileira — cobre as 4 mascaras em uso (antigo com/sem hifen,
// Mercosul com/sem hifen): XXX-0000, XXX0000, XXX0X00, XXX-0X00. Extrai de
// dentro de texto livre. Usado tanto pelo sync do SIAT (vehicle_info, ex.
// "177 - van - MASTER V A6 PAS - UPD9C09") quanto pelo cliente da Ituran
// (nickname, ex. "UPN2F99 - FAB / PERNAMBUCANAS - Mahas" — o license_plate
// da API vem vazio, confirmado real). Sempre devolve sem hifen, pro mesmo
// formato ja usado em Vehicle.plate.
const PLATE_PATTERN = /\b([A-Z]{3})-?([0-9][A-Z0-9][0-9]{2})\b/;

export function extractPlate(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.toUpperCase().match(PLATE_PATTERN);
  return match ? `${match[1]}${match[2]}` : null;
}
