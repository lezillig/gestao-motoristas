import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSofitAvailable } from "@/lib/sofit/client";
import { syncSofitFuelCore } from "@/app/(app)/combustivel/sofitActions";

// Diario, retomando sempre da ultima transacao Sofit ja importada (ver
// syncSofitFuelCore) — nunca refaz o historico inteiro, entao cabe folgado
// no teto de 60s do plano Hobby mesmo com frota grande.
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
    const result = await syncSofitFuelCore(company.id);
    results.push({ companyId: company.id, ...result });
  }

  return NextResponse.json({ results });
}
