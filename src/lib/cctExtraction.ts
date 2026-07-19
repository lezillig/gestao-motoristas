import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { readFile } from "fs/promises";
import { z } from "zod";

// Extração assistida por IA das regras de uma CCT — Fase 3 do blueprint.
// Nunca ativa regras sozinha: retorna sugestões que o usuário revisa e
// adiciona uma a uma pelo mesmo fluxo manual (ver /convencoes/actions.ts).
// Desativada sem ANTHROPIC_API_KEY; o cadastro manual continua funcionando.

export function isCctExtractionAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const TIPOS = [
  "JORNADA_DIARIA",
  "HORA_EXTRA",
  "BANCO_HORAS",
  "ADICIONAL_NOTURNO",
  "INTERVALO",
  "JORNADA_12X36",
  "OUTRO",
] as const;

const SuggestedRegraSchema = z.object({
  tipo: z.enum(TIPOS),
  valorNumerico: z.number().nullable(),
  descricao: z.string(),
});

const ExtractionResultSchema = z.object({
  regras: z.array(SuggestedRegraSchema),
});

export type SuggestedRegra = z.infer<typeof SuggestedRegraSchema>;

const SYSTEM_PROMPT = `Você é um assistente especializado em direito do trabalho brasileiro, lendo convenções coletivas de trabalho (CCT) do setor de transporte rodoviário/fretamento.

Extraia cláusulas que definem regras quantificáveis de jornada e remuneração e devolva-as como uma lista estruturada. Tipos de regra e a unidade esperada de valorNumerico:
- JORNADA_DIARIA: horas de jornada normal antes de hora extra (ex: 8, 9). Numérico obrigatório.
- HORA_EXTRA: percentual de adicional sobre a hora normal (ex: 50, 60). Numérico obrigatório.
- BANCO_HORAS: limite de horas acumuláveis em banco de horas. Numérico obrigatório.
- ADICIONAL_NOTURNO: percentual de adicional noturno. Numérico obrigatório.
- INTERVALO: minutos mínimos de intervalo/descanso. Numérico obrigatório.
- JORNADA_12X36: valorNumerico nulo; descreva as condições de elegibilidade em descricao.
- OUTRO: qualquer outra regra quantificável relevante que não se encaixe acima; valorNumerico nulo se não houver um número único aplicável.

Extraia apenas regras explícitas no texto, citando o número da cláusula/artigo na descrição quando possível. Não invente valores. Se uma cláusula for ambígua, inclua-a com a leitura mais literal e mencione a ambiguidade na descrição. Se nenhuma regra quantificável for encontrada, devolva uma lista vazia.`;

export async function extractRegrasFromPdf(filePath: string): Promise<SuggestedRegra[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY não configurada — extração por IA indisponível.");
  }

  const client = new Anthropic({ apiKey });
  const pdfBase64 = (await readFile(filePath)).toString("base64");

  const message = await client.beta.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_format: betaZodOutputFormat(ExtractionResultSchema),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
          },
          {
            type: "text",
            text: "Extraia as regras estruturadas desta convenção coletiva conforme as instruções do sistema.",
          },
        ],
      },
    ],
  });

  if (!message.parsed_output) {
    throw new Error("A IA não retornou uma resposta estruturada válida.");
  }
  return message.parsed_output.regras;
}
