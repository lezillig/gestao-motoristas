import { get } from "@vercel/blob";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  const { id } = await params;

  const convencao = await prisma.convencaoColetiva.findUnique({
    where: { id, companyId: session.companyId },
  });
  if (!convencao) {
    return new Response("Não encontrado", { status: 404 });
  }

  const blob = await get(convencao.fileUrl, { access: "private" });
  if (!blob || blob.statusCode !== 200) {
    return new Response("Arquivo não encontrado", { status: 404 });
  }

  const safeFileName = convencao.fileName.replace(/[^\w.\- ]/g, "_");
  return new Response(blob.stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFileName}"`,
    },
  });
}
