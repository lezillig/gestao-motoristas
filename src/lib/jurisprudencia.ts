import type { RiskLevel } from "@/lib/pontoCompliance";

// Camada interpretativa: NAO e um motor de busca de jurisprudencia, e uma
// lista pequena e curada de padroes de risco de litigio, aplicada em cima
// das violacoes ja calculadas pelos outros dois eixos (CLT e CCT/ACT).
// Cada item cita a fonte e e tratado como alerta informativo — nao e
// aconselhamento juridico nem substitui uma avaliacao pelo setor juridico.

export type DriverViolationSummary = {
  driverId: string;
  missingIntervalCount: number;
  interjornadaCount: number;
  excessiveOvertimeCount: number;
  missingRestStreaks: number;
  // Opcional: hora extra total dos 3 meses imediatamente anteriores ao mes
  // selecionado (mais antigo primeiro) e do proprio mes selecionado — usado
  // so pelo check de supressao habitual (Sumula 291) abaixo. Quando ausente
  // (chamador nao forneceu), esse check simplesmente nao roda pro
  // motorista.
  priorMonthsOvertimeMinutes?: number[];
  currentMonthOvertimeMinutes?: number;
};

// Limiar pra considerar "hora extra habitual" num mes, pro fim do check de
// supressao (Sumula 291) — mesma ideia de habitualidade do check diario
// existente, aplicada mes a mes em vez de dia a dia.
const HABITUAL_MONTHLY_OVERTIME_MINUTES = 10 * 60;
// Abaixo disso no mes selecionado, apos 3 meses seguidos de habitualidade,
// e tratado como corte abrupto pro fim deste alerta.
const SUPPRESSED_MONTHLY_OVERTIME_MINUTES = 2 * 60;

export type JurisprudenceRisk = {
  driverId: string;
  id: string;
  title: string;
  citation: string;
  level: RiskLevel;
  description: string;
};

export function annotateJurisprudenceRisks(
  summaries: DriverViolationSummary[]
): JurisprudenceRisk[] {
  const risks: JurisprudenceRisk[] = [];

  for (const s of summaries) {
    if (s.missingIntervalCount >= 3) {
      risks.push({
        driverId: s.driverId,
        id: "intervalo-habitual",
        title: "Ausência habitual de registro de intervalo",
        citation: "Súmula 338, I, TST (por analogia — controle de ponto incompleto)",
        level: "alto",
        description: `${s.missingIntervalCount} turno(s) no período sem intervalo intrajornada registrado. Controle de ponto incompleto de forma recorrente tende a favorecer a versão do motorista em eventual reclamação sobre intervalo não usufruído.`,
      });
    }

    if (s.interjornadaCount >= 2) {
      risks.push({
        driverId: s.driverId,
        id: "interjornada-recorrente",
        title: "Interjornada violada mais de uma vez",
        citation: "Art. 66 e 235-C, §4º CLT — entendimento consolidado de pagamento como extra do período suprimido",
        level: "alto",
        description: `${s.interjornadaCount} violação(ões) de interjornada no período. Reincidência aumenta o risco de reconhecimento de horas extras pelo descanso não respeitado.`,
      });
    }

    if (s.excessiveOvertimeCount >= 5) {
      risks.push({
        driverId: s.driverId,
        id: "hora-extra-habitual",
        title: "Hora extra excessiva e habitual",
        citation: "Art. 59 CLT — jornada extraordinária deve ser exceção, não rotina",
        level: "medio",
        description: `${s.excessiveOvertimeCount} dia(s) no período com mais de 2h de hora extra. Habitualidade dificulta a defesa de que a extra era eventual e pode gerar reflexos em DSR, 13º e férias.`,
      });
    }

    if (
      s.priorMonthsOvertimeMinutes &&
      s.priorMonthsOvertimeMinutes.length >= 3 &&
      s.priorMonthsOvertimeMinutes.every((m) => m >= HABITUAL_MONTHLY_OVERTIME_MINUTES) &&
      (s.currentMonthOvertimeMinutes ?? 0) < SUPPRESSED_MONTHLY_OVERTIME_MINUTES
    ) {
      risks.push({
        driverId: s.driverId,
        id: "supressao-hora-extra-habitual",
        title: "Possível supressão de hora extra habitual",
        citation: "Súmula 291, TST",
        level: "medio",
        description: `Hora extra consistente (10h+/mês) nos 3 meses anteriores caiu para quase zero neste mês. Se a redução partiu do empregador (não do motorista), pode gerar indenização correspondente ao período suprimido.`,
      });
    }

    if (s.missingRestStreaks >= 1) {
      risks.push({
        driverId: s.driverId,
        id: "dsr-violado",
        title: "Descanso semanal não observado",
        citation: "Art. 7º, XV, CF/88 e art. 67 CLT",
        level: "alto",
        description: "Sequência de dias trabalhados sem folga além do limite esperado para a escala do motorista, identificada no período. Prática frequentemente sancionada com pedido de dobra do DSR em reclamações trabalhistas.",
      });
    }
  }

  return risks;
}
