// Placa no mesmo formato guardado no cadastro de veiculos: maiuscula, sem
// hifen nem espaco (ABC1D23). Existe porque cada sistema externo escreve a
// placa do seu jeito — a Cobli devolve "ABC-1D23", o extrato de combustivel
// devolve "abc1d23" — e casar por texto so funciona com os dois lados
// normalizados do mesmo jeito.
export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "");
}
