import { addDays } from "date-fns";
import { prisma } from "@/lib/prisma";

export const LEAVE_LABELS: Record<string, string> = {
  folga: "Folga",
  atestado: "Atestado",
  ferias: "Férias",
  abono: "Abono",
};

export type ExcecaoDia = {
  driverId: string;
  driverName: string;
  tipo: "escala_sem_ponto" | "ponto_sem_escala";
  afastamento: string | null;
};

// "Tem escala e ponto batendo nesse dia?" pra TODOS os motoristas ativos de
// uma vez — devolve so quem diverge. Usado pela tela de Exceções do dia e
// pelo painel Hoje (D-1). `dayStart` precisa ser um rotulo de data (ver
// parseLocalDate/brazilDayLabel), igual ao que Escala.date e
// TimeClockEntry.date guardam. De proposito NAO cruza Ituran/abastecimento
// (isso e por veiculo, mais pesado pra empresa inteira) — pra esse detalhe
// existe a auditoria completa de um motorista/dia.
export async function fetchExcecoesDoDia(companyId: string, dayStart: Date): Promise<ExcecaoDia[]> {
  const dayEnd = addDays(dayStart, 1);

  const [drivers, escalas, entries, leaves] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
    }),
    prisma.escala.findMany({
      where: { companyId, date: { gte: dayStart, lt: dayEnd } },
      select: { driverId: true },
    }),
    prisma.timeClockEntry.findMany({
      where: { companyId, date: { gte: dayStart, lt: dayEnd } },
      select: { driverId: true },
    }),
    prisma.driverLeave.findMany({
      where: { companyId, startDate: { lte: dayStart }, endDate: { gte: dayStart } },
      select: { driverId: true, leaveType: true },
    }),
  ]);

  const driversComEscala = new Set(escalas.map((e) => e.driverId));
  const driversComPonto = new Set(entries.map((e) => e.driverId));
  const leaveByDriverId = new Map(leaves.map((l) => [l.driverId, l.leaveType]));

  const excecoes: ExcecaoDia[] = [];
  for (const d of drivers) {
    const temEscala = driversComEscala.has(d.id);
    const temPonto = driversComPonto.has(d.id);
    if (temEscala === temPonto) continue;
    const afastamento = leaveByDriverId.get(d.id) ?? null;
    excecoes.push({
      driverId: d.id,
      driverName: d.name,
      tipo: temEscala ? "escala_sem_ponto" : "ponto_sem_escala",
      afastamento: afastamento ? (LEAVE_LABELS[afastamento] ?? afastamento) : null,
    });
  }
  // Afastamento explica a ausencia — nao esconde a linha (o afastamento em
  // si pode estar mal cadastrado), mas manda pro fim, priorizando quem
  // realmente precisa de atencao.
  excecoes.sort((a, b) => (a.afastamento ? 1 : 0) - (b.afastamento ? 1 : 0));
  return excecoes;
}
