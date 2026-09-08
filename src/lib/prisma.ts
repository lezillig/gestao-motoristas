import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Sem isso, o driver da Neon so acha WebSocket nativo em runtimes recentes
// o bastante (Node 22+) — setar explicitamente funciona em qualquer versao
// de Node, e nao tem custo nenhum quando o adapter da Neon nem chega a ser
// usado (dev local, ver createPrismaClient abaixo).
neonConfig.webSocketConstructor = ws;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// A conexao padrao do Prisma (driver "pg", TCP+TLS) paga uma negociacao de
// conexao inteira a cada instancia FRIA de funcao serverless na Vercel —
// perceptivel como lentidao geral do sistema, confirmado real (2026-09-08).
// A Neon expoe um driver proprio por WebSocket feito pra evitar exatamente
// esse custo em ambiente serverless, e e o adapter oficialmente recomendado
// pela propria Prisma pra esse combo (Next.js + Neon + Vercel). So troca
// pra ele quando a DATABASE_URL e realmente da Neon ("neon.tech" no host);
// localmente (Postgres comum, sem Neon) cai no driver padrao do Prisma sem
// nenhuma mudanca de comportamento — dev continua igual.
//
// O Pool/WebSocket criado aqui e module-level, reaproveitado entre
// invocacoes de uma mesma instancia da funcao (nao por request) — seguro
// porque essa app roda em runtime Node.js normal da Vercel, nao Edge/
// Workers (onde a Neon recomenda o oposto, um Pool por request, porque la
// o WebSocket literalmente nao sobrevive entre invocacoes).
function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("neon.tech")) {
    return new PrismaClient();
  }
  const adapter = new PrismaNeon({ connectionString: url });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
