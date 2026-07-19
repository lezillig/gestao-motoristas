import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";

export const SESSION_COOKIE = "gestao_motoristas_session";

// Sem fallback proposital: assinar/verificar sessao com uma chave publica e
// conhecida (ex.: um valor padrao hardcoded) permitiria forjar um JWT valido
// para qualquer usuario/empresa caso a variavel de ambiente nao esteja
// configurada. Falha alto (throw) em vez de falhar aberto (fallback inseguro).
function getSecret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error(
      "JWT_SECRET não configurado. Defina essa variável de ambiente antes de autenticar usuários."
    );
  }
  return new TextEncoder().encode(value);
}

export type SessionPayload = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  companyId: string;
};

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(getSecret());
}

export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireRole(...roles: Role[]): Promise<SessionPayload> {
  const session = await requireSession();
  if (!roles.includes(session.role)) redirect("/dashboard");
  return session;
}
