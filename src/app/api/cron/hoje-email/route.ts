import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildHoje } from "@/lib/hoje";
import { renderHojeEmail } from "@/lib/hojeEmail";
import { hojeEmailDestinatarios, isEmailAvailable, sendEmail } from "@/lib/email";

// Agendado no vercel.json pras 10:00 UTC (= 07:00 Brasilia), depois de TODOS
// os outros crons (o ultimo, multas da LW, roda 07:45 UTC) — o e-mail e um
// retrato do painel /hoje e so faz sentido com o D-1 ja sincronizado.
// Desligado sem RESEND_API_KEY ou sem HOJE_EMAIL_PARA (nada quebra).
export const maxDuration = 60;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isEmailAvailable()) {
    return NextResponse.json({ skipped: "RESEND_API_KEY não configurada" }, { status: 200 });
  }
  const destinatarios = hojeEmailDestinatarios();
  if (destinatarios.length === 0) {
    return NextResponse.json({ skipped: "HOJE_EMAIL_PARA vazio" }, { status: 200 });
  }

  const baseUrl = process.env.APP_BASE_URL ?? req.nextUrl.origin;
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const enviados: { company: string; id: string; subject: string }[] = [];
  const errors: string[] = [];

  for (const company of companies) {
    try {
      const hoje = await buildHoje(company.id);
      const { subject, html } = renderHojeEmail(hoje, { companyName: company.name, baseUrl });
      const r = await sendEmail({ to: destinatarios, subject, html });
      enviados.push({ company: company.name, id: r.id, subject });
    } catch (e) {
      errors.push(`${company.name}: ${e instanceof Error ? e.message : "falha"}`);
    }
  }

  return NextResponse.json({ destinatarios: destinatarios.length, enviados, errors });
}
