import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signSession, SESSION_COOKIE } from "@/lib/auth";

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

  // A leitura do usuário é protegida para separar DUAS falhas que a tela
  // mostrava igual: senha errada e banco fora do ar.
  //
  // Sem isto, uma indisponibilidade do Postgres derrubava a rota, o navegador
  // recebia uma página de erro em vez de JSON, e o formulário caía no texto
  // genérico "Não foi possível entrar" — a mesma frase que apareceria para uma
  // senha errada. Quem está na frente da tela conclui que errou a senha e
  // tenta de novo, enquanto o problema real é o banco.
  //
  // O texto de credencial continua genérico de propósito: dizer "este e-mail
  // não existe" entregaria a quem tenta adivinhar quais endereços são válidos.
  let user;
  try {
    user = await prisma.user.findUnique({ where: { email } });
  } catch {
    return NextResponse.json(
      {
        error:
          "O banco de dados não respondeu. Não é a sua senha — tente de novo em alguns minutos.",
      },
      { status: 503 }
    );
  }

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
