// Validacao real de CPF (algoritmo oficial dos 2 digitos verificadores),
// nao so contagem de digitos. Nenhum import ate agora fazia essa checagem —
// so validava "tem 11 digitos", o que deixa passar erro de digitacao/OCR
// (ex.: dois digitos trocados) como se fosse um CPF valido.
export function isValidCPF(cpfDigitsOnly: string): boolean {
  if (!/^\d{11}$/.test(cpfDigitsOnly)) return false;
  if (/^(\d)\1{10}$/.test(cpfDigitsOnly)) return false; // todos os digitos iguais (000..., 111..., etc.)

  const digits = cpfDigitsOnly.split("").map(Number);

  const checkDigit = (base: number[], factorStart: number): number => {
    const sum = base.reduce((acc, d, i) => acc + d * (factorStart - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const d1 = checkDigit(digits.slice(0, 9), 10);
  if (d1 !== digits[9]) return false;
  const d2 = checkDigit(digits.slice(0, 10), 11);
  if (d2 !== digits[10]) return false;

  return true;
}

// Planilha pode trazer o CPF como celula numerica (perde zero(s) a
// esquerda) — mesmo problema ja visto em cadastros/clientes/actions.ts e
// combustivel/actions.ts. Normaliza pra digitos-so + zero a esquerda ANTES
// de validar, senao um CPF real que perdeu o zero e rejeitado a toa.
export function normalizeCpf(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.padStart(11, "0");
}
