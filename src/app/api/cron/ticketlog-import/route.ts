import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTicketLogAvailable, fetchFuelCardStatuses } from "@/lib/ticketlog/client";
import { syncTicketLogCardStatusesCore } from "@/app/(app)/combustivel/cartoes/actions";

// Diario — atualiza o snapshot de saldo/limite por cartao (ver
// FuelCardStatus no schema). Volume baixo (~370 cartoes) e uma chamada so a
// API, cabe folgado no teto de 60s do plano Hobby, sem precisar de
// auto-encadeamento.
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
  if (!isTicketLogAvailable()) {
    return NextResponse.json({ error: "Ticket Log não configurado" }, { status: 200 });
  }

  const companies = await prisma.company.findMany({ select: { id: true } });
  const statuses = await fetchFuelCardStatuses();

  const results = [];
  for (const company of companies) {
    const result = await syncTicketLogCardStatusesCore(company.id, statuses);
    results.push({ companyId: company.id, ...result });
  }

  return NextResponse.json({ results });
}
