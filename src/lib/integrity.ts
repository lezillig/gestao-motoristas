import { createHash } from "crypto";

// Estado relevante de um TimeClockEntry pra fins de hash — so os campos que
// realmente definem a jornada registrada (nao inclui id/companyId/driverId/
// date, que identificam QUAL registro, nao O QUE ele diz; nem createdAt/
// updatedAt/hashAtual, que sao metadados da propria escrita).
export type PontoHashState = {
  clockIn: string;
  clockOut: string | null;
  intervaloInicio: string | null;
  intervaloFim: string | null;
  esperaInicio: string | null;
  esperaFim: string | null;
  punches: unknown;
};

// So entrada/saida de cada par entram no hash — geolocalizacao e tipo de
// registro (app/web) sao metadado que pode ser preenchido retroativamente
// numa reimportacao sem que a jornada em si tenha mudado (ver
// src/lib/tiquetaque/importCore.ts, backfill de metadado que
// deliberadamente NAO gera TimeClockCorrection). Mesmo escopo que
// `punchesKey` ja usa la pra decidir o que conta como mudanca real —
// manter os dois em sincronia, senao o hash muda em silencio (sem
// correcao correspondente) e a cadeia de verificacao acusa falso positivo.
function normalizePunches(punches: unknown): { entrada: unknown; saida: unknown }[] | null {
  if (!Array.isArray(punches)) return null;
  return punches.map((p) => {
    const rec = p as Record<string, unknown>;
    return { entrada: rec?.entrada ?? null, saida: rec?.saida ?? null };
  });
}

// Serializacao canonica (chaves em ordem fixa, nunca a ordem de insercao do
// objeto de entrada) — sem isso, dois objetos com o mesmo conteudo mas
// construidos em ordem diferente gerariam hashes diferentes, quebrando a
// cadeia de verificacao por um motivo espurio.
function canonicalize(state: PontoHashState): string {
  return JSON.stringify({
    clockIn: state.clockIn,
    clockOut: state.clockOut ?? null,
    intervaloInicio: state.intervaloInicio ?? null,
    intervaloFim: state.intervaloFim ?? null,
    esperaInicio: state.esperaInicio ?? null,
    esperaFim: state.esperaFim ?? null,
    punches: normalizePunches(state.punches),
  });
}

export function hashPontoState(state: PontoHashState): string {
  return createHash("sha256").update(canonicalize(state)).digest("hex");
}

export type IntegrityStatus = "integro" | "divergente" | "nao_verificavel";

// Verifica a cadeia de hashes de um TimeClockEntry: cada correcao (mais
// antiga primeiro) deve ter hashAntes == hashDepois da anterior (ou, pra
// primeira, e o ponto de partida da cadeia); a ultima correcao (se houver)
// deve ter hashDepois == hashAtual do registro; e o hash recomputado AGORA
// a partir do conteudo real do registro deve bater com hashAtual — essa
// ultima checagem e a que pega uma edicao feita por fora do app (ex.: script
// direto no banco), que muda o conteudo sem passar pelo codigo que
// atualiza hashAtual.
// "nao_verificavel" (nao "divergente") quando falta hash em algum elo —
// cobre registros/correcoes criados antes deste campo existir, pra nunca
// acusar falsamente uma alteracao antiga de "violada".
export function verifyEntryIntegrity(
  entry: { hashAtual: string | null } & PontoHashState,
  correctionsOldestFirst: { hashAntes: string | null; hashDepois: string | null }[]
): IntegrityStatus {
  const liveHash = hashPontoState(entry);
  if (!entry.hashAtual) return "nao_verificavel";
  if (liveHash !== entry.hashAtual) return "divergente";

  if (correctionsOldestFirst.length === 0) return "integro";

  for (const c of correctionsOldestFirst) {
    if (!c.hashAntes || !c.hashDepois) return "nao_verificavel";
  }
  for (let i = 1; i < correctionsOldestFirst.length; i++) {
    if (correctionsOldestFirst[i].hashAntes !== correctionsOldestFirst[i - 1].hashDepois) return "divergente";
  }
  const last = correctionsOldestFirst[correctionsOldestFirst.length - 1];
  if (last.hashDepois !== entry.hashAtual) return "divergente";

  return "integro";
}
