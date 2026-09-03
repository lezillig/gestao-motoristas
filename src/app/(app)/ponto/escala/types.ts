export type EscalaDetail = { id: string; startTime: string; endTime: string | null };

export type PontoEscalaRow = {
  driverId: string;
  driverName: string;
  dateISO: string; // yyyy-MM-dd
  startScheduled: string;
  startActual: string;
  startDiff: number;
  endScheduled: string | null;
  endActual: string | null;
  endDiff: number | null;
  entryId: string;
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
