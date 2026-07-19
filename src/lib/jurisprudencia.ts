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
};

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
