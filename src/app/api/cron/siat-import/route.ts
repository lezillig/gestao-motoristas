import { NextRequest, NextResponse } from "next/server";
import { format, subDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { isSiatAvailable } from "@/lib/siat/client";
import { syncFromSiatCore } from "@/app/(app)/escalas/siatActions";

// Agendado no vercel.json pra rodar as 05:30 UTC (= 02:30 horario de
// Brasilia) — depois do TiqueTaque (05:00 UTC) e ANTES da Ituran (06:00
// UTC), de proposito: o cron da Ituran casa cada viagem com a Escala do dia
// NA HORA em que roda (ver matchEscalaForVehicleTrips em
// vehicleTripEscala.ts), entao a Escala de ontem precisa estar sincronizada
// antes daquele cron rodar, senao o cruzamento fica sempre vazio. Sem esse
// cron a Escala ficava parada na ultima sincronizacao manual, esvaziando o
// cruzamento em /telemetria/viagens depois de alguns dias.
//
// Um unico dia de reservas (fetchReservations com dateFrom=dateTo) e rapido
// — cabe folgado no teto de 60s do plano Hobby, sem precisar do
// auto-encadeamento usado no cron do TiqueTaque.
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
  if (!isSiatAvailable()) {
    return NextResponse.json({ error: "SIAT não configurado" }, { status: 200 });
  }

  const date = format(subDays(new Date(), 1), "yyyy-MM-dd");
  const companies = await prisma.company.findMany({ select: { id: true } });

  const results = [];
  for (const company of companies) {
    const result = await syncFromSiatCore(company.id, date, date);
    results.push({ companyId: company.id, ...result });
  }

  return NextResponse.json({ date, results });
}
