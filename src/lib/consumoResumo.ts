// Parser do "Relatorio Resumido de Consumo" — um HTML disfarçado de .xls
// (exportacao comum de sistemas web de gestao de frota), NAO um Excel de
// verdade. Estrutura confirmada em 7 arquivos reais (jan-jul/2026): 17
// colunas fixas por linha de veiculo, agrupadas em blocos "CONTRATO: X".
//
// Deliberadamente um parser proprio via regex, sem nova dependencia (nada
// de cheerio) — a estrutura e fixa e ja foi verificada contra dados reais.
// Frágil a mudanca de formato do sistema de origem (mesmo tipo de limitacao
// ja documentada em outros pontos do projeto, ex. findInactiveLinkTransactions).

export type ConsumoResumoRow = {
  placa: string;
  contrato: string;
  tipoCombustivel: string;
  // Coluna "Ultima Km e/ou H" — parte da chave de identidade da linha:
  // o mesmo veiculo/contrato/combustivel pode aparecer 2x legitimamente no
  // mesmo periodo (ex. dois lotes de leitura), diferenciados so por este
  // valor. Descobri isso perdendo R$1.694,94 de janeiro/2026 num teste real
  // antes de incluir este campo na chave unica (ver actions.ts).
  ultimoKmOuHora: number | null;
  kmRodados: number | null;
  horasTrabalhadas: number | null;
  litros: number;
  valorMedioLitroCents: number | null;
  kmPorLitro: number | null;
  litrosPorHora: number | null;
  totalCents: number;
};

export function isConsumoResumoHtml(texto: string): boolean {
  return texto.includes("Relat") && texto.includes("Resumido de Consumo") && texto.includes("Per");
}

export function parsePeriodo(texto: string): { inicio: Date; fim: Date } | null {
  const match = /(\d{2})\/(\d{2})\/(\d{4})\s*a\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(texto);
  if (!match) return null;
  const [, d1, m1, y1, d2, m2, y2] = match;
  return {
    inicio: new Date(Number(y1), Number(m1) - 1, Number(d1)),
    fim: new Date(Number(y2), Number(m2) - 1, Number(d2)),
  };
}

// "-" ou vazio -> null (o relatorio usa "-" pra "nao se aplica", ex.
// Horas Trabalhadas num veiculo controlado por km). Numero em formato BR
// ("1.234,56") -> float.
export function parseBRNumber(texto: string): number | null {
  const t = texto.trim();
  if (!t || t === "-") return null;
  const num = parseFloat(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&atilde;/g, "ã")
    .replace(/&otilde;/g, "õ")
    .replace(/&ccedil;/g, "ç")
    .replace(/&Uacute;/g, "Ú")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseConsumoResumoRows(html: string): ConsumoResumoRow[] {
  const rows: ConsumoResumoRow[] = [];
  let contratoAtual = "";

  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(html))) {
    const trOpenTag = html.slice(trMatch.index, trMatch.index + 200);
    const inner = trMatch[1];

    const contratoMatch = /CONTRATO:\s*([^<]*)/.exec(inner);
    if (contratoMatch) {
      contratoAtual = stripTags(contratoMatch[1]).trim();
      continue;
    }

    const isDataRow = /class="Linha(Impar|Par)"/.test(trOpenTag);
    if (!isDataRow) continue;

    const cells = [...inner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
    if (cells.length < 17) continue;

    const [
      placa,
      ,
      ,
      ,
      ,
      ,
      tipoCombustivel,
      ,
      ,
      ultimoKmOuHoraText,
      kmRodadosText,
      horasTrabalhadasText,
      litrosText,
      valorMedioLitroText,
      kmPorLitroText,
      litrosPorHoraText,
      totalText,
    ] = cells;

    const litros = parseBRNumber(litrosText);
    const total = parseBRNumber(totalText);
    if (!placa || litros === null || total === null) continue;

    const valorMedioLitro = parseBRNumber(valorMedioLitroText);

    rows.push({
      placa: placa.toUpperCase().replace(/[\s-]/g, ""),
      contrato: contratoAtual || "ND",
      tipoCombustivel: tipoCombustivel.trim(),
      ultimoKmOuHora: parseBRNumber(ultimoKmOuHoraText),
      kmRodados: parseBRNumber(kmRodadosText),
      horasTrabalhadas: parseBRNumber(horasTrabalhadasText),
      litros,
      valorMedioLitroCents: valorMedioLitro !== null ? Math.round(valorMedioLitro * 100) : null,
      kmPorLitro: parseBRNumber(kmPorLitroText),
      litrosPorHora: parseBRNumber(litrosPorHoraText),
      totalCents: Math.round(total * 100),
    });
  }

  return rows;
}
