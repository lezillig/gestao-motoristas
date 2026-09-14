import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signSession, SESSION_COOKIE } from "@/lib/auth";
import { consumirCota, ipDoCliente, minutosAte } from "@/lib/rateLimit";

// Forca bruta: janela de 15 min por IP e por e-mail. Conta toda tentativa
// (nao so as erradas) — um usuario legitimo nao tenta 10 vezes em 15 min.
const JANELA_MS = 15 * 60_000;
const LIMITE_POR_IP = 30;
const LIMITE_POR_EMAIL = 10;

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const [porIp, porEmail] = await Promise.all([
    consumirCota(`login:ip:${ipDoCliente(req.headers)}`, LIMITE_POR_IP, JANELA_MS),
    consumirCota(`login:email:${email.toLowerCase()}`, LIMITE_POR_EMAIL, JANELA_MS),
  ]);
  if (!porIp.permitido || !porEmail.permitido) {
    const bloqueado = porIp.permitido ? porEmail : porIp;
    return NextResponse.json(
      { error: `Muitas tentativas de login. Aguarde ${minutosAte(bloqueado.reiniciaEm)} minuto(s) e tente de novo.` },
      { status: 429, headers: { "Retry-After": String(minutosAte(bloqueado.reiniciaEm) * 60) } }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.active) {
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }

  const token = await signSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
  });

  const res = NextResponse.json({ ok: true, role: user.role });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
