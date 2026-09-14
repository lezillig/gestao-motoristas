import { prisma } from "@/lib/prisma";

// Rate limit de janela fixa guardado no banco (tabela RateLimit): a funcao
// serverless nao tem memoria compartilhada, e o plano atual da Vercel nao
// oferece regra de WAF por rota. Precisao de "mais ou menos": duas
// requisicoes simultaneas podem passar uma a mais — irrelevante pro que
// protege (forca bruta no login, custo de API no assistente).

export type CotaResultado = { permitido: boolean; restante: number; reiniciaEm: Date };

export async function consumirCota(chave: string, limite: number, janelaMs: number): Promise<CotaResultado> {
  const agora = new Date();
  try {
    const atual = await prisma.rateLimit.findUnique({ where: { chave } });
    if (!atual || atual.reiniciaEm <= agora) {
      const reiniciaEm = new Date(agora.getTime() + janelaMs);
      await prisma.rateLimit.upsert({
        where: { chave },
        create: { chave, contagem: 1, reiniciaEm },
        update: { contagem: 1, reiniciaEm },
      });
      return { permitido: true, restante: limite - 1, reiniciaEm };
    }
    const upd = await prisma.rateLimit.update({ where: { chave }, data: { contagem: { increment: 1 } } });
    return { permitido: upd.contagem <= limite, restante: Math.max(0, limite - upd.contagem), reiniciaEm: upd.reiniciaEm };
  } catch (e) {
    // Falha aberta de proposito: indisponibilidade do contador nao pode
    // derrubar o login inteiro. Fica no log.
    console.error("[rateLimit]", e instanceof Error ? e.message : e);
    return { permitido: true, restante: limite, reiniciaEm: agora };
  }
}

// IP do cliente atras do proxy da Vercel (primeiro da lista x-forwarded-for).
export function ipDoCliente(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim() || headers.get("x-real-ip") || "desconhecido";
  return ip.slice(0, 64);
}

export function minutosAte(d: Date): number {
  return Math.max(1, Math.ceil((d.getTime() - Date.now()) / 60_000));
}
