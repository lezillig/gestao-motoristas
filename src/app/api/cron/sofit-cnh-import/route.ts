import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSofitAvailable } from "@/lib/sofit/client";
import { syncSofitCnhCore } from "@/lib/sofit/cnhSync";

// Diario — pedido explicito do usuario (2026-09-05), Sofit tratada como
// fonte de verdade pro vencimento de CNH (sobrescreve o que ja tinhamos
// aqui quando ela tem o dado, ver comentario em lib/sofit/cnhSync.ts). O
// cadastro de funcionario da Sofit e pequeno (~600 registros) e cabe
// folgado no teto de 60s — sem auto-encadeamento como o de combustivel/
// TiqueTaque, que lidam com volume bem maior.
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
  if (!isSofitAvailable()) {
    return NextResponse.json({ error: "Sofit não configurado" }, { status: 200 });
  }

  const companies = await prisma.company.findMany({ select: { id: true } });

  const results = [];
  for (const company of companies) {
    try {
      const result = await syncSofitCnhCore(company.id, Date.now() + 45_000);
      results.push({ companyId: company.id, ...result });
    } catch (e) {
      results.push({ companyId: company.id, error: e instanceof Error ? e.message : "erro desconhecido" });
    }
  }

  return NextResponse.json({ results });
}
