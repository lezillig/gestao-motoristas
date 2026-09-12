import { AlertTriangle } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { cardClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { isAssistenteAvailable } from "@/lib/assistente/run";
import AssistenteChat from "./AssistenteChat";

const SUGESTOES = [
  "O que precisa da minha atenção hoje?",
  "Quais multas vencem o prazo de indicação nos próximos 5 dias?",
  "Qual veículo teve o maior custo por km no mês passado?",
  "Quem são os 5 motoristas com maior risco nos últimos 30 dias?",
  "Quantas horas o motorista João fez em agosto?",
];

export default async function AssistentePage() {
  await requireRole("ADMIN", "GESTOR");
  const available = isAssistenteAvailable();

  return (
    <div>
      <PageHeader
        title="Assistente da operação"
        subtitle="Perguntas em linguagem natural respondidas com consultas reais ao sistema — motoristas, veículos, escalas, ponto, multas, Ituran, combustível e custos."
      />

      {!available ? (
        <div className={`${cardClass} flex items-start gap-3 border-amber-200 bg-amber-50`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            Assistente desligado: configure <code className="font-mono">ANTHROPIC_API_KEY</code> nas variáveis de ambiente pra habilitar.
          </p>
        </div>
      ) : (
        <AssistenteChat sugestoes={SUGESTOES} />
      )}
    </div>
  );
}
