import Anthropic from "@anthropic-ai/sdk";
import { utcInstantToLocalParts } from "@/lib/date";
import { buildAssistenteTools } from "./tools";

// Opus 5 com thinking adaptativo e effort "medium": perguntas de consulta
// com 3-5 chamadas de ferramenta precisam caber nos 60s do plano Hobby da
// Vercel, e "high" (padrão) alonga demais a etapa de raciocínio pra ganho
// pequeno nesse tipo de tarefa. fallbacks "default" faz o servidor rodar a
// mesma pergunta em outro modelo se o Opus 5 recusar por política — sem
// isso a recusa simplesmente encerra a resposta.
export const ASSISTENTE_MODEL = "claude-opus-5";
const MAX_ITERACOES = 8;
const HISTORICO_MAX_TURNOS = 12;

export function isAssistenteAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type MensagemHistorico = { role: "user" | "assistant"; content: string };
export type FerramentaUsada = { nome: string; entrada: Record<string, unknown> };
export type RespostaAssistente = { resposta: string; ferramentas: FerramentaUsada[] };

// Fixo (sem data/empresa) de proposito: e o prefixo cacheado junto com as
// ferramentas. O que varia por chamada vai na mensagem do usuario.
const SYSTEM_PROMPT = `Você é o assistente da operação do sistema Gestão de Motoristas, usado por gestores de uma empresa de fretamento (ônibus e vans com motorista). Responde em português do Brasil.

Como trabalhar:
- Toda informação factual vem das ferramentas. Nunca invente nome, placa, número, data ou valor. Se a ferramenta não trouxer o dado, diga isso claramente e aponte onde o gestor pode conferir.
- Antes de consultar por motorista ou veículo, localize-o com buscar_motoristas / buscar_veiculos para obter o id. Se houver mais de um candidato plausível, pergunte qual é em vez de escolher por conta própria.
- Você só consulta. Nunca diga que alterou, enviou, indicou ou registrou algo.
- Datas em dd/MM/yyyy, horários de Brasília, valores em R$. "Ontem" é o último dia fechado: viagens da Ituran, ponto e escala chegam de madrugada, então "hoje" costuma estar incompleto — avise quando isso afetar a resposta.
- Comece pela resposta, depois o detalhe necessário. Use lista curta quando houver vários registros. Sem preâmbulo nem repetição da pergunta.
- Quando houver uma tela do sistema com o detalhe, termine com um link em markdown com caminho relativo. Rotas úteis: /hoje · /risco?dias=30 · /custos?mes=yyyy-MM · /multas · /combustivel?mes=yyyy-MM · /escalas?semana=yyyy-MM-dd · /telemetria/viagens?vehicleId=ID&dateFrom=yyyy-MM-dd&dateTo=yyyy-MM-dd · /utilizacao/auditoria?driverId=ID&vehicleId=ID&data=yyyy-MM-dd (auditoria completa de um motorista/veículo num dia: ponto, escala, Ituran e abastecimento lado a lado) · /utilizacao/auditoria/excecoes?data=yyyy-MM-dd · /cadastros/motoristas/ID · /cadastros/veiculos/ID.
- Limitações que valem mencionar quando forem relevantes para a pergunta: a viagem da Ituran é atribuída ao motorista pela escala do SIAT do mesmo veículo no mesmo dia; os pontos de CNH são só das multas atribuídas neste sistema, não o prontuário do DETRAN; combustível e multa por cliente são rateio pelos dias de escala do veículo.`;

export async function perguntarAssistente(params: {
  companyId: string;
  companyName: string;
  historico: MensagemHistorico[];
  pergunta: string;
}): Promise<RespostaAssistente> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const agora = utcInstantToLocalParts(new Date().toISOString())!;

  const historico: Anthropic.Beta.BetaMessageParam[] = params.historico
    .slice(-HISTORICO_MAX_TURNOS)
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));

  const runner = client.beta.messages.toolRunner({
    model: ASSISTENTE_MODEL,
    max_tokens: 8000,
    max_iterations: MAX_ITERACOES,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: buildAssistenteTools(params.companyId),
    messages: [
      ...historico,
      {
        role: "user",
        content: `Contexto desta conversa: empresa "${params.companyName}"; agora são ${agora.dateISO.split("-").reverse().join("/")} ${agora.time} (Brasília).\n\n${params.pergunta}`,
      },
    ],
  });

  const ferramentas: FerramentaUsada[] = [];
  let ultima: Anthropic.Beta.BetaMessage | null = null;
  for await (const message of runner) {
    ultima = message;
    for (const block of message.content) {
      if (block.type === "tool_use") {
        ferramentas.push({ nome: block.name, entrada: (block.input ?? {}) as Record<string, unknown> });
      }
    }
  }

  if (!ultima) return { resposta: "Não consegui obter resposta do modelo.", ferramentas };

  if (ultima.stop_reason === "refusal") {
    return { resposta: "Não posso ajudar com essa pergunta.", ferramentas };
  }

  const texto = ultima.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!texto) {
    return {
      resposta:
        "Não consegui concluir a consulta dentro do limite de passos. Tente uma pergunta mais específica (um motorista, um veículo ou um período menor).",
      ferramentas,
    };
  }
  if (ultima.stop_reason === "max_tokens") {
    return { resposta: `${texto}\n\n_(resposta cortada por tamanho — peça a continuação)_`, ferramentas };
  }
  return { resposta: texto, ferramentas };
}
