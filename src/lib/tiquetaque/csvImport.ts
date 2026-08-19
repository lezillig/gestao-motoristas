import type { TiqueTaqueDayEntry, TiqueTaquePunchPair } from "./types";

// Parser puro (sem import de servidor) pra planilha oficial de exportacao em
// massa do TiqueTaque — roda no browser, ao selecionar o arquivo, antes de
// qualquer chamada ao servidor. Formato confirmado com arquivo real
// (2026-08-19): CSV ISO-8859-1 (Latin-1), delimitador ";", 1 linha por
// motorista/dia (todo o periodo, inclusive dias de folga). Cabecalho:
// "nome;cod_matricula;data;dia_semana;entrada_1;saida_1;...;entrada_N;
// saida_N;extra_50;extra_100;banco_50;banco_100;anotacoes;total" — N varia
// entre exportacoes (ate 7 no arquivo grande, ate 3 em exports de 1 dia so),
// entao os pares sao resolvidos por NOME de coluna, nao posicao fixa.
//
// Motivo de existir (2026-08-19): comparando esse arquivo oficial contra o
// nosso pareamento heuristico (src/lib/tiquetaque/pairing.ts) numa varredura
// completa, achamos 907 dias com diferenca > 1h — a API publica de batidas
// avulsas nao informa a direcao real (entrada vs saida) de cada marcacao,
// entao nosso pareamento so adivinha por ordem cronologica + teto de
// plausibilidade, e erra sistematicamente quando uma batida noturna fica sem
// par real (o TiqueTaque sabe disso internamente; a gente nao). Esse arquivo
// ja traz os pares certos, decididos pelo proprio TiqueTaque.
function normName(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

function parseBrDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseHhmm(raw: string): string | null {
  const t = raw.trim();
  return /^\d{1,2}:\d{2}$/.test(t) ? t : null;
}

export function parseTiqueTaqueBulkCsv(text: string): {
  byDriverName: Map<string, TiqueTaqueDayEntry[]>;
  totalRows: number;
  totalDriverDays: number;
} {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const byDriverName = new Map<string, TiqueTaqueDayEntry[]>();
  if (lines.length === 0) return { byDriverName, totalRows: 0, totalDriverDays: 0 };

  const header = lines[0].split(";").map((h) => h.trim());
  const idxNome = header.indexOf("nome");
  const idxData = header.indexOf("data");
  const pairCols: { entrada: number; saida: number }[] = [];
  for (let n = 1; ; n++) {
    const entradaIdx = header.indexOf(`entrada_${n}`);
    const saidaIdx = header.indexOf(`saida_${n}`);
    if (entradaIdx === -1 || saidaIdx === -1) break;
    pairCols.push({ entrada: entradaIdx, saida: saidaIdx });
  }

  let totalDriverDays = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    const nome = normName(cols[idxNome] ?? "");
    const date = parseBrDate(cols[idxData] ?? "");
    if (!nome || !date) continue;

    const pairs: TiqueTaquePunchPair[] = [];
    for (const { entrada, saida } of pairCols) {
      const entradaHhmm = parseHhmm(cols[entrada] ?? "");
      if (!entradaHhmm) continue; // sem entrada nessa posicao, nao ha mais pares a coletar
      pairs.push({ entrada: entradaHhmm, saida: parseHhmm(cols[saida] ?? "") });
    }
    if (pairs.length === 0) continue; // dia de folga, sem nenhuma batida

    const lastPair = pairs[pairs.length - 1];
    const day: TiqueTaqueDayEntry = {
      date,
      clockIn: pairs[0].entrada,
      clockOut: lastPair.saida,
      intervaloInicio: pairs.length > 1 ? pairs[0].saida : null,
      intervaloFim: pairs.length > 1 ? pairs[1].entrada : null,
      pairs,
    };

    const list = byDriverName.get(nome) ?? [];
    list.push(day);
    byDriverName.set(nome, list);
    totalDriverDays++;
  }

  return { byDriverName, totalRows: lines.length - 1, totalDriverDays };
}
