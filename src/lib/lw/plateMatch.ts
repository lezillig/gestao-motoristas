import { platePhysicalVariants } from "@/lib/plate";
import type { LwVeiculoDTO } from "./types";

// Casa a placa do nosso cadastro (Vehicle.plate) contra o cadastro de
// veiculos da propria LW (GET /veiculos/todosVeiculos) — usado em vez de
// so gerar variantes antigo/Mercosul da nossa placa e tentar consultar,
// porque a LW tambem guarda algumas placas com o mesmo erro de digitacao
// ("I" no lugar de "1") que a Ituran comete, um erro pontual que a
// conversao antigo/Mercosul nao resolve (nao e um remapeamento sistematico,
// e OCR errado numa posicao especifica — confirmado real 2026-09-09,
// comparando a frota inteira). Perguntar pra propria LW "sob qual grafia
// este veiculo esta cadastrado" e mais robusto que adivinhar variantes.
function editDistance1(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return diff === 1;
}

export interface LwMatch {
  registro: LwVeiculoDTO;
  // Qual grafia usar pra consultar /multas/buscarMulta/{placa} pra este
  // veiculo — a que efetivamente bateu, nao necessariamente ourPlate.
  placaParaConsulta: string;
}

export function matchVehicleToLw(ourPlate: string, lwVeiculos: LwVeiculoDTO[]): LwMatch | null {
  const ourVariants = platePhysicalVariants(ourPlate);

  for (const registro of lwVeiculos) {
    for (const lwPlaca of [registro.placa, registro.placaMercosul].filter((p): p is string => Boolean(p))) {
      const lwVariants = platePhysicalVariants(lwPlaca.trim().toUpperCase());
      if (ourVariants.some((v) => lwVariants.includes(v))) {
        return { registro, placaParaConsulta: lwPlaca.trim().toUpperCase() };
      }
    }
  }

  // Sem batida exata em nenhuma variante — tenta erro de 1 caractere
  // (typo pontual, ex. BYX8I75 na LW vs BYX8175 nosso cadastro).
  for (const registro of lwVeiculos) {
    for (const lwPlaca of [registro.placa, registro.placaMercosul].filter((p): p is string => Boolean(p))) {
      const lwUpper = lwPlaca.trim().toUpperCase();
      if (ourVariants.some((v) => editDistance1(v, lwUpper))) {
        return { registro, placaParaConsulta: lwUpper };
      }
    }
  }

  return null;
}
