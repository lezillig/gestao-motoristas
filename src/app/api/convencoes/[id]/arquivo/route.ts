import path from "path";
import { readFile } from "fs/promises";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const CCT_STORAGE_ROOT = path.join(process.cwd(), "private-uploads", "convencoes");

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

  let buffer: Buffer;
  try {
    buffer = await readFile(path.join(CCT_STORAGE_ROOT, convencao.fileUrl));
  } catch {
    return new Response("Arquivo não encontrado", { status: 404 });
  }

  const safeFileName = convencao.fileName.replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFileName}"`,
    },
  });
}
