"use server";

import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildHoje } from "@/lib/hoje";
import { renderHojeEmail } from "@/lib/hojeEmail";
import { isEmailAvailable, sendEmail } from "@/lib/email";

// Envia o e-mail do painel Hoje SO pro proprio usuario logado — serve pra
// conferir o provedor (Resend) e o visual antes de confiar no cron diario.
// Devolve resultado em vez de lancar (erro lancado em Server Action chega
// redigido em producao, ver memoria do projeto).
export async function enviarHojeParaMim(): Promise<{ ok: boolean; message: string }> {
  const session = await requireRole("ADMIN", "GESTOR");
  if (!isEmailAvailable()) return { ok: false, message: "E-mail desligado: configure RESEND_API_KEY." };
  try {
    const h = await headers();
    const baseUrl = process.env.APP_BASE_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost:3000"}`;
    const [company, hoje] = await Promise.all([
      prisma.company.findUnique({ where: { id: session.companyId }, select: { name: true } }),
      buildHoje(session.companyId),
    ]);
    const { subject, html } = renderHojeEmail(hoje, { companyName: company?.name ?? "empresa", baseUrl });
    await sendEmail({ to: [session.email], subject, html });
    return { ok: true, message: `Enviado para ${session.email}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falha ao enviar." };
  }
}
