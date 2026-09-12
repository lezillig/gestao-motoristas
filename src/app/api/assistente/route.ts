import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAssistenteAvailable, perguntarAssistente } from "@/lib/assistente/run";

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
    return NextResponse.json({ error: e instanceof Error ? e.message : "Falha ao consultar o assistente." }, { status: 500 });
  }
}
