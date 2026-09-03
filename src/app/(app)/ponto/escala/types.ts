export type EscalaDetail = { id: string; startTime: string; endTime: string | null };

// Linha do relatorio e um "outer join": aparece se HOUVER escala OU ponto
// batido naquele dia (nao exige os dois) — startScheduled/startActual (e os
// diffs) ficam null pro lado que faltar, em vez de a linha simplesmente nao
// aparecer.
export type PontoEscalaRow = {
  driverId: string;
  driverName: string;
  dateISO: string; // yyyy-MM-dd
  startScheduled: string | null;
  startActual: string | null;
  startDiff: number | null;
  endScheduled: string | null;
  endActual: string | null;
  endDiff: number | null;
  entryId: string | null;
  intervaloInicio: string | null;
  intervaloFim: string | null;
  escalas: EscalaDetail[]; // todas as reservas do SIAT que formam o dia (drill-down)
};

export type ColumnKey =
  | "motorista"
  | "data"
  | "inicioSiat"
  | "inicioPonto"
  | "diffInicio"
  | "fimSiat"
  | "fimPonto"
  | "diffFim";

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  motorista: "Motorista",
  data: "Data",
  inicioSiat: "Início — SIAT",
  inicioPonto: "Início — Ponto",
  diffInicio: "Diferença",
  fimSiat: "Fim — SIAT",
  fimPonto: "Fim — Ponto",
  diffFim: "Diferença",
};

export const DEFAULT_COLUMN_ORDER: ColumnKey[] = [
  "motorista",
  "data",
  "inicioSiat",
  "inicioPonto",
  "diffInicio",
  "fimSiat",
  "fimPonto",
  "diffFim",
];
