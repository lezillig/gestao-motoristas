import { prisma } from "@/lib/prisma";
import { cnhAlertLevel, requiresCnh } from "@/lib/driverAlerts";

export type SubstitutoSugerido = { driverId: string; driverName: string };

export type ProximaViagemEmRisco = {
  escalaId: string;
  date: Date;
  startTime: string;
  routeName: string | null;
  clientName: string | null;
};

export type CnhRisco = {
  driverId: string;
  driverName: string;
  cnhCategory: string | null;
  cnhExpiration: Date | null;
  nivel: "vencida" | "vence_em_breve";
  // null quando o motorista nao tem nenhuma escala futura — alerta de CNH
  // continua valendo, so nao tem urgencia operacional imediata pra achar
  // substituto.
  proximaViagem: ProximaViagemEmRisco | null;
  substitutos: SubstitutoSugerido[];
};

// Cruza o alerta de CNH (ja existente, ver driverAlerts.ts) com a escala do
// SIAT: motorista com CNH vencida/vencendo que TEM viagem agendada vira uma
// decisao urgente, nao so um lembrete — sugere quem mais poderia cobrir.
//
// Substituto = motorista ativo, que precisa de CNH (cargo de motorista),
// com CNH em dia, MESMA categoria do motorista em risco (de proposito nao
// tenta hierarquia entre categorias tipo "E cobre D" — uma regra errada
// aqui tem consequencia de seguranca/trabalhista, mais vale ser
// conservador e so sugerir categoria identica), e sem escala no mesmo dia
// da viagem em risco.
export async function buildCnhVigia(companyId: string, now = new Date()): Promise<CnhRisco[]> {
  const drivers = await prisma.driver.findMany({
    where: { companyId, active: true },
    select: { id: true, name: true, funcao: true, cnhCategory: true, cnhExpiration: true },
  });

  const atRisk = drivers.filter((d) => {
    const level = cnhAlertLevel(d.cnhExpiration, d.funcao, now);
    return level === "vencida" || level === "vence_em_breve";
  });
  if (atRisk.length === 0) return [];

  const escalasFuturas = await prisma.escala.findMany({
    where: { companyId, driverId: { in: atRisk.map((d) => d.id) }, date: { gte: now } },
    orderBy: { date: "asc" },
    select: { id: true, driverId: true, date: true, startTime: true, routeName: true, clientName: true },
  });
  const proximaEscalaByDriver = new Map<string, (typeof escalasFuturas)[number]>();
  for (const e of escalasFuturas) {
    if (!proximaEscalaByDriver.has(e.driverId)) proximaEscalaByDriver.set(e.driverId, e);
  }

  const datasRelevantes = [...new Set([...proximaEscalaByDriver.values()].map((e) => e.date.getTime()))];
  const escalasNasDatas =
    datasRelevantes.length > 0
      ? await prisma.escala.findMany({
          where: { companyId, date: { in: datasRelevantes.map((t) => new Date(t)) } },
          select: { driverId: true, date: true },
        })
      : [];
  const ocupadosPorData = new Map<number, Set<string>>();
  for (const e of escalasNasDatas) {
    const key = e.date.getTime();
    const set = ocupadosPorData.get(key) ?? new Set<string>();
    set.add(e.driverId);
    ocupadosPorData.set(key, set);
  }

  const candidatePool = drivers.filter(
    (d) => requiresCnh(d.funcao) && cnhAlertLevel(d.cnhExpiration, d.funcao, now) === "ok"
  );

  return atRisk.map((d) => {
    const proxima = proximaEscalaByDriver.get(d.id) ?? null;
    let substitutos: SubstitutoSugerido[] = [];
    if (proxima) {
      const ocupados = ocupadosPorData.get(proxima.date.getTime()) ?? new Set<string>();
      substitutos = candidatePool
        .filter((c) => c.cnhCategory === d.cnhCategory && !ocupados.has(c.id))
        .slice(0, 3)
        .map((c) => ({ driverId: c.id, driverName: c.name }));
    }
    return {
      driverId: d.id,
      driverName: d.name,
      cnhCategory: d.cnhCategory,
      cnhExpiration: d.cnhExpiration,
      nivel: cnhAlertLevel(d.cnhExpiration, d.funcao, now) as "vencida" | "vence_em_breve",
      proximaViagem: proxima
        ? { escalaId: proxima.id, date: proxima.date, startTime: proxima.startTime, routeName: proxima.routeName, clientName: proxima.clientName }
        : null,
      substitutos,
    };
  });
}
