import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Upload direto do navegador pro Vercel Blob (nao passa pela funcao
// serverless) — os requests de Server Action/Route Handler na Vercel tem
// um limite de corpo de 4,5MB IMPOSTO PELA PLATAFORMA, que existe
// independente do `bodySizeLimit` do Next.js (esse so controla o proprio
// Next, nao o limite de infraestrutura da Vercel por baixo). Confirmado
// real (2026-09-08): upload de convenção coletiva real (PDF escaneado,
// bem acima de 4,5MB) travava com "This page couldn't load" — a conexao
// e derrubada pela borda da Vercel antes de chegar na nossa funcao,
// entao nem gera um erro tratavel pelo Next. Esta rota so troca um token
// de upload; o arquivo em si vai direto do navegador pro Blob storage.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const session = await requireRole("ADMIN", "GESTOR");
        // pathname e montado no cliente como "<sindicatoId>/<timestamp>-<nome>"
        // (ver ConvencaoForm.tsx) — confirma que o sindicato pertence a
        // empresa do usuario ANTES de emitir o token, mesma checagem que
        // ja existia em createConvencao pra montar o path original.
        const sindicatoId = pathname.split("/")[0];
        const sindicato = await prisma.sindicato.findUnique({
          where: { id: sindicatoId, companyId: session.companyId },
        });
        if (!sindicato) {
          throw new Error("Sindicato não encontrado.");
        }
        // "access" (privado) e decidido no cliente (ver upload() em
        // ConvencaoForm.tsx) — o SDK nao aceita esse campo aqui.
        return {
          allowedContentTypes: ["application/pdf"],
          addRandomSuffix: false,
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao gerar token de upload." },
      { status: 400 }
    );
  }
}
