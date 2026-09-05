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

// So um chute inicial pro campo de nome (sempre editavel na tela) quando o
// admin escolhe "criar novo sindicato" — tenta extrair a sigla curta do
// comeco do texto legal completo da planilha (ex.: "SINDIFRETUR   SIND
// EMPREG EMPRES TRANSP..." -> "SINDIFRETUR"), incluindo sufixo de estado
// quando separado por hifen (ex.: "SINDLOC - MA" -> "SINDLOC-MA"). Quando o
// texto comeca direto com a palavra generica "SIND"/"SINDICATO" (sem sigla
// própria antes), nao tem o que extrair — devolve o texto inteiro mesmo.
export function suggestShortName(fullText: string): string {
  const tokens = fullText.trim().split(/\s+/);
  if (tokens.length === 0 || !tokens[0]) return fullText;

  let first = tokens[0];
  const hyphenSuffixSameToken = first.match(/^([A-Z0-9]+)-([A-Z]{2,4})$/);
  if (hyphenSuffixSameToken) {
    first = hyphenSuffixSameToken[1];
  } else if (first.includes("-")) {
    first = first.split("-")[0];
  }

  if (first === "SIND" || first === "SINDICATO" || first.length < 4) return fullText;

  if (hyphenSuffixSameToken) return `${first}-${hyphenSuffixSameToken[2]}`;
  if (tokens[1] === "-" && tokens[2] && /^[A-Z]{2,4}$/.test(tokens[2]) && tokens[2] !== "SIND") return `${first}-${tokens[2]}`;
  return first;
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
