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

// Conversao oficial Mercosul do 5o caractere (o antigo 2o digito da dezena
// de placa): 0-9 -> A-J. Usado pra gerar as duas grafias possiveis da MESMA
// placa fisica (antiga toda-digito vs Mercosul com letra na 5a posicao) —
// necessario porque fontes externas variam qual formato guardam pro mesmo
// veiculo (confirmado real 2026-09-09: a LW Tecnologia tem varios veiculos
// cadastrados no formato antigo enquanto a Ituran/SIAT ja reportam Mercosul,
// ver src/lib/lw/plateMatch.ts).
const MERCOSUL_DIGIT_TO_LETTER = "ABCDEFGHIJ";

export function toOldFormatPlate(plate: string): string {
  if (plate.length !== 7) return plate;
  const pos5 = plate[4];
  const digit = MERCOSUL_DIGIT_TO_LETTER.indexOf(pos5);
  if (digit < 0) return plate; // ja e formato antigo (5a posicao ja e digito)
  return plate.slice(0, 4) + digit + plate.slice(5);
}

export function toMercosulFormatPlate(plate: string): string {
  if (plate.length !== 7) return plate;
  const pos5 = plate[4];
  if (!/[0-9]/.test(pos5)) return plate; // ja e Mercosul (5a posicao ja e letra)
  return plate.slice(0, 4) + MERCOSUL_DIGIT_TO_LETTER[Number(pos5)] + plate.slice(5);
}

// Todas as grafias plausiveis da mesma placa fisica, pra comparar/consultar
// contra uma fonte externa sem assumir qual formato ela guarda.
export function platePhysicalVariants(plate: string): string[] {
  const upper = plate.trim().toUpperCase();
  return [...new Set([upper, toOldFormatPlate(upper), toMercosulFormatPlate(upper)])];
}
