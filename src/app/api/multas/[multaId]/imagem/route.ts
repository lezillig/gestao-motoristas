import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLwToken, buscarPrimeiraImagemMulta } from "@/lib/lw/client";
import { integracoesPermitidas, MENSAGEM_INTEGRACOES_BLOQUEADAS } from "@/lib/integracoesEmpresa";

// Serve a imagem de notificacao da multa direto da LW (proxy — a LW exige
// Bearer token, entao nao da pra apontar o <img> direto pra la do
// navegador). Sem cache HTTP de proposito: a imagem so muda se a multa for
// re-notificada, caso raro, e o custo de buscar de novo a cada clique e
// baixo (1 usuario olhando 1 multa por vez, nao um loop).
const TIPOS_PERMITIDOS = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "application/pdf"]);

export async function GET(_req: Request, { params }: { params: Promise<{ multaId: string }> }) {
  const session = await requireRole("ADMIN", "GESTOR");
  if (!(await integracoesPermitidas(session.companyId))) return new Response(MENSAGEM_INTEGRACOES_BLOQUEADAS, { status: 403 });
  const { multaId } = await params;

  const multa = await prisma.multa.findUnique({ where: { id: multaId, companyId: session.companyId } });
  if (!multa) return new Response("Não encontrado", { status: 404 });

  try {
    const token = await getLwToken();
    const imagem = await buscarPrimeiraImagemMulta(token, multa.lwId);
    if (!imagem) return new Response("Nenhuma imagem disponível para esta multa.", { status: 404 });

    const bytes = Buffer.from(imagem.imagem, "base64");
    // Content-Type vem da LW: so aceita tipos de imagem/PDF conhecidos, para
    // nunca servir text/html (XSS na origem do app) por engano do fornecedor.
    const tipo = TIPOS_PERMITIDOS.has((imagem.imagemTipo || "").toLowerCase()) ? imagem.imagemTipo.toLowerCase() : "image/jpeg";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": tipo,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="multa-${multa.lwId}.jpg"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Falha ao buscar imagem na LW.", { status: 502 });
  }
}
