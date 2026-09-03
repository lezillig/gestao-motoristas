// Casamento de nome de sindicato entre a exportacao da folha de pagamento
// (texto legal completo, ex.: "SINDIFRETUR SIND EMPREG EMPRES TRANSP DE
// PASSAGEIROS P FRETAMENTO E TURISMO GRANDE SAO PAULO") e o cadastro no
// sistema (normalmente so a sigla/nome curto, ex.: "SINDIFRETUR").
export type SindicatoOption = { id: string; nome: string };

function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "SIND",
  "SINDICATO",
  "DOS",
  "DAS",
  "DO",
  "DA",
  "DE",
  "E",
  "EM",
  "NO",
  "NA",
  "EMPRESAS",
  "EMPRES",
  "EMPREG",
  "EMPREGADOS",
  "TRANSPORTES",
  "TRANSPORTE",
  "TRANSP",
  "PASSAGEIROS",
  "REGIAO",
  "MUNICIPIO",
]);

function significantTokens(s: string): Set<string> {
  return new Set(
    normalizeForMatch(s)
      .split(" ")
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

// So usado pra decidir automaticamente na importacao — por isso e
// conservador: casamento exato, ou o nome cadastrado (a sigla curta)
// aparece de corpo inteiro dentro do texto da planilha. Nao usa
// similaridade "aproximada" aqui pra nao arriscar linkar motorista no
// sindicato errado sem revisao humana.
export function findSindicatoMatch(payrollText: string, sindicatos: SindicatoOption[]): SindicatoOption | null {
  const target = normalizeForMatch(payrollText);
  if (!target) return null;

  const exact = sindicatos.find((s) => normalizeForMatch(s.nome) === target);
  if (exact) return exact;

  const bySubstring = sindicatos.find((s) => {
    const nome = normalizeForMatch(s.nome);
    return nome.length >= 4 && target.includes(nome);
  });
  return bySubstring ?? null;
}

// Usado so pro relatorio/preview (nunca aplica automatico): sugere o
// sindicato cadastrado mais parecido por sobreposicao de palavras
// significativas (Dice coefficient), mesmo sem substring exata — ajuda a
// achar "SINDIFRETUR" cadastrado como "SIND EMPREG EMPRES TRANSP..." com
// grafia diferente da sigla.
export function suggestSindicatoMatch(
  payrollText: string,
  sindicatos: SindicatoOption[]
): { sindicato: SindicatoOption; score: number } | null {
  const targetTokens = significantTokens(payrollText);
  if (targetTokens.size === 0) return null;

  let best: { sindicato: SindicatoOption; score: number } | null = null;
  for (const s of sindicatos) {
    const nomeTokens = significantTokens(s.nome);
    if (nomeTokens.size === 0) continue;
    const common = [...nomeTokens].filter((t) => targetTokens.has(t)).length;
    const dice = (2 * common) / (nomeTokens.size + targetTokens.size);
    if (dice > 0 && (!best || dice > best.score)) {
      best = { sindicato: s, score: dice };
    }
  }
  return best;
}
