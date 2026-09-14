import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAssistenteAvailable, perguntarAssistente } from "@/lib/assistente/run";
import { consumirCota, minutosAte } from "@/lib/rateLimit";

// Cada pergunta pode custar ate 8 iteracoes do modelo; sem teto por usuario
// um loop (ou uma aba esquecida repetindo) vira custo de API sem limite.
const PERGUNTAS_POR_JANELA = 20;
const JANELA_MS = 10 * 60_000;

// Teto do plano Hobby da Vercel — uma pergunta com 3-5 consultas ao banco
// costuma levar 10-30s. Route Handler (nao Server Action) pra poder fixar
// isso e devolver erro tipado em JSON.
export const maxDuration = 60;

const BodySchema = z.object({
  pergunta: z.string().trim().min(1).max(2000),
  historico: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20)
    .default([]),
});

export async function POST(req: NextRequest) {
  const session = await requireRole("ADMIN", "GESTOR");
  if (!isAssistenteAvailable()) {
    return NextResponse.json({ error: "Assistente não configurado (ANTHROPIC_API_KEY ausente)." }, { status: 503 });
  }

  const cota = await consumirCota(`assistente:user:${session.userId}`, PERGUNTAS_POR_JANELA, JANELA_MS);
  if (!cota.permitido) {
    return NextResponse.json(
      { error: `Limite de ${PERGUNTAS_POR_JANELA} perguntas em 10 minutos atingido — aguarde ${minutosAte(cota.reiniciaEm)} minuto(s).` },
      { status: 429 }
    );
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pergunta inválida." }, { status: 400 });
  }

  const company = await prisma.company.findUnique({ where: { id: session.companyId }, select: { name: true } });

  try {
    const resposta = await perguntarAssistente({
      companyId: session.companyId,
      companyName: company?.name ?? "empresa",
      historico: parsed.data.historico,
      pergunta: parsed.data.pergunta,
    });
    return NextResponse.json(resposta);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Muitas perguntas ao mesmo tempo — tente de novo em alguns segundos." }, { status: 429 });
    }
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Chave da API da Anthropic inválida." }, { status: 503 });
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Falha na API da Anthropic (${e.status}).` }, { status: 502 });
    }
    // Nao repassa e.message: erro de Prisma/parse pode carregar nome de
    // tabela, host do banco ou caminho de arquivo.
    console.error("[assistente]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Falha ao consultar o assistente — tente de novo em instantes." }, { status: 500 });
  }
}
