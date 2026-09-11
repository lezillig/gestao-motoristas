import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { brazilDateTimeToUtc } from "@/lib/date";
import type { Prisma, StatusIndicacaoCondutor } from "@prisma/client";

export const MULTA_SORT_FIELDS = [
  "placa",
  "dataInfracao",
  "valorCents",
  "dataLimiteIndicacao",
  "indicacaoStatus",
] as const;
export type MultaSortField = (typeof MULTA_SORT_FIELDS)[number];

export const INDICACAO_STATUS_OPTIONS = [
  { value: "PENDENTE_MANUAL", label: "Pendente — selecione o motorista" },
  { value: "SUGERIDA", label: "Sugerido" },
  { value: "ENVIADA", label: "Enviado à LW" },
  { value: "VALIDADA", label: "Validado" },
  { value: "REJEITADA", label: "Rejeitado" },
];

export type MultasFilters = {
  situacaoLw: string[];
  indicacaoStatus: string[];
  vehicleId: string[];
  driverId: string[];
};

export function buildMultasWhere(companyId: string, filters: MultasFilters): Prisma.MultaWhereInput {
  const where: Prisma.MultaWhereInput = { companyId };
  if (filters.situacaoLw.length > 0) where.situacaoLw = { in: filters.situacaoLw };
  if (filters.vehicleId.length > 0) where.vehicleId = { in: filters.vehicleId };
  if (filters.indicacaoStatus.length > 0 || filters.driverId.length > 0) {
    where.indicacao = {
      ...(filters.indicacaoStatus.length > 0
        ? { status: { in: filters.indicacaoStatus as StatusIndicacaoCondutor[] } }
        : {}),
      ...(filters.driverId.length > 0 ? { driverId: { in: filters.driverId } } : {}),
    };
  }
  return where;
}

export function buildMultasOrderBy(sortField: MultaSortField, sortDir: "asc" | "desc"): Prisma.MultaOrderByWithRelationInput {
  switch (sortField) {
    case "placa":
      return { vehicle: { plate: sortDir } };
    case "valorCents":
      return { valorCents: { sort: sortDir, nulls: "last" } };
    case "dataLimiteIndicacao":
      return { dataLimiteIndicacao: { sort: sortDir, nulls: "last" } };
    case "indicacaoStatus":
      return { indicacao: { status: sortDir } };
    default:
      return { dataInfracao: { sort: sortDir, nulls: "last" } };
  }
}

export const MULTAS_PAGE_SIZE = 50;

// Usado tanto pela tela (paginado) quanto pela exportacao (pagina inteira,
// ver page abaixo) — mesmo espirito de fetchMotoristasList, garante que o
// arquivo exportado reflita exatamente os mesmos filtros/ordenacao vistos
// na tela. `page` e 1-based; omitido = sem paginacao (usado na exportacao,
// que precisa de todas as linhas filtradas, nao so uma pagina).
export async function fetchMultasList(
  companyId: string,
  filters: MultasFilters,
  sortField: MultaSortField,
  sortDir: "asc" | "desc",
  page?: number
) {
  return prisma.multa.findMany({
    where: buildMultasWhere(companyId, filters),
    include: {
      vehicle: { select: { plate: true } },
      indicacao: { include: { driver: { select: { id: true, name: true, cpf: true, cnh: true } } } },
    },
    orderBy: buildMultasOrderBy(sortField, sortDir),
    ...(page ? { skip: (page - 1) * MULTAS_PAGE_SIZE, take: MULTAS_PAGE_SIZE } : {}),
  });
}

export async function fetchMultasCount(companyId: string, filters: MultasFilters): Promise<number> {
  return prisma.multa.count({ where: buildMultasWhere(companyId, filters) });
}

// Contagem pro alerta de prazo (vencido / vencendo em breve) — sempre sobre
// TODAS as multas da empresa, independente de filtro/pagina atual (e um
// aviso geral, nao um resumo da tela). Contado direto no banco (nao busca
// as linhas) pra nao repetir o mesmo problema de custo que motivou a
// paginacao da listagem.
export async function fetchPrazoAlertCounts(companyId: string, agora: Date): Promise<{ vencido: number; vencendoEm5Dias: number }> {
  const em5Dias = new Date(agora.getTime() + 5 * 86_400_000);
  const semIndicacaoConfirmadaWhere: Prisma.MultaWhereInput["indicacao"] = {
    status: { notIn: ["ENVIADA", "VALIDADA"] as StatusIndicacaoCondutor[] },
  };
  const [vencido, vencendoEm5Dias] = await Promise.all([
    prisma.multa.count({
      where: { companyId, dataLimiteIndicacao: { lt: agora }, indicacao: semIndicacaoConfirmadaWhere },
    }),
    prisma.multa.count({
      where: { companyId, dataLimiteIndicacao: { gte: agora, lte: em5Dias }, indicacao: semIndicacaoConfirmadaWhere },
    }),
  ]);
  return { vencido, vencendoEm5Dias };
}

export type EscalaDoDia = { driverName: string; startTime: string; endTime: string | null };

// Motorista(s) escalado(s) no SIAT pro veiculo, no dia da infracao — mostra
// TODA escala do dia (nao so a que bate o horario, ao contrario da
// resolucao automatica em resolveCondutor.ts), pra dar visibilidade
// completa de diagnostico: usuario pediu isso depois de duvidar se a
// sugestao automatica realmente cruzou com o SIAT ou nao (2026-09-11).
// 1 query batch pra pagina inteira, nao 1 por linha.
export async function fetchEscalasDoDiaPorMultas(
  companyId: string,
  multas: { vehicleId: string | null; dataInfracao: Date | null }[]
): Promise<Map<string, EscalaDoDia[]>> {
  const pares = multas.filter(
    (m): m is { vehicleId: string; dataInfracao: Date } => m.vehicleId !== null && m.dataInfracao !== null
  );
  if (pares.length === 0) return new Map();

  const escalas = await prisma.escala.findMany({
    where: { companyId, OR: pares.map((p) => ({ vehicleId: p.vehicleId, date: p.dataInfracao })) },
    select: { vehicleId: true, date: true, startTime: true, endTime: true, driver: { select: { name: true } } },
  });

  const map = new Map<string, EscalaDoDia[]>();
  for (const e of escalas) {
    const key = `${e.vehicleId}|${e.date.getTime()}`;
    const lista = map.get(key) ?? [];
    lista.push({ driverName: e.driver.name, startTime: e.startTime, endTime: e.endTime });
    map.set(key, lista);
  }
  return map;
}

export type IturanCruzamento = {
  enderecoViagem: string | null;
  distanciaMinutos: number;
  dentroDaViagem: boolean;
};

// Cruza o horario da infracao com as viagens reais da Ituran (VehicleTrip)
// do mesmo veiculo — pedido do usuario pra comparar o endereco da
// notificacao com onde o rastreador realmente estava. Usa
// brazilDateTimeToUtc (NAO combineLocalDateTime, usado em
// resolveCondutor.ts pra VehicleUsageLog): VehicleTrip.startAt/endAt sao
// timestamp real em UTC de verdade, vindo direto da API da Ituran, ao
// contrario de VehicleUsageLog.checkInAt, que guarda a hora BRT "crua" como
// se fosse UTC (convencao interna deste app onde os dois lados de toda
// comparacao usam o mesmo deslocamento e por isso se cancelam) — cruzar
// contra a Ituran exige a conversao correta, senao da uma diferenca de 3h.
export async function fetchIturanCruzamentoPorMultas(
  companyId: string,
  multas: { id: string; vehicleId: string | null; dataInfracao: Date | null; horaInfracao: string | null }[]
): Promise<Map<string, IturanCruzamento>> {
  const validas = multas
    .filter((m): m is { id: string; vehicleId: string; dataInfracao: Date; horaInfracao: string } =>
      Boolean(m.vehicleId && m.dataInfracao && m.horaInfracao)
    )
    .map((m) => ({
      id: m.id,
      vehicleId: m.vehicleId,
      instant: brazilDateTimeToUtc(format(m.dataInfracao, "yyyy-MM-dd"), m.horaInfracao),
    }));
  if (validas.length === 0) return new Map();

  const vehicleIds = [...new Set(validas.map((v) => v.vehicleId))];
  // Folga de 6h pra cada lado — o suficiente pra achar a viagem mais
  // proxima mesmo quando a infracao aconteceu fora de qualquer viagem
  // registrada (veiculo parado).
  const FOLGA_MS = 6 * 60 * 60 * 1000;
  const minInstant = new Date(Math.min(...validas.map((v) => v.instant.getTime())) - FOLGA_MS);
  const maxInstant = new Date(Math.max(...validas.map((v) => v.instant.getTime())) + FOLGA_MS);

  const trips = await prisma.vehicleTrip.findMany({
    where: { companyId, vehicleId: { in: vehicleIds }, startAt: { lte: maxInstant }, endAt: { gte: minInstant } },
    select: { vehicleId: true, startAt: true, endAt: true, startAddress: true, endAddress: true },
  });

  const tripsByVehicle = new Map<string, typeof trips>();
  for (const t of trips) {
    const lista = tripsByVehicle.get(t.vehicleId) ?? [];
    lista.push(t);
    tripsByVehicle.set(t.vehicleId, lista);
  }

  const result = new Map<string, IturanCruzamento>();
  for (const v of validas) {
    let melhor: IturanCruzamento | null = null;
    for (const t of tripsByVehicle.get(v.vehicleId) ?? []) {
      const dentro = v.instant >= t.startAt && v.instant <= t.endAt;
      const distStart = Math.abs(v.instant.getTime() - t.startAt.getTime());
      const distEnd = Math.abs(v.instant.getTime() - t.endAt.getTime());
      const usarInicio = distStart <= distEnd;
      const distMs = usarInicio ? distStart : distEnd;
      if (!melhor || dentro || distMs < melhor.distanciaMinutos * 60_000) {
        melhor = {
          enderecoViagem: usarInicio ? t.startAddress : t.endAddress,
          distanciaMinutos: Math.round(distMs / 60_000),
          dentroDaViagem: dentro,
        };
      }
      if (dentro) break;
    }
    // Uma viagem a mais de 3h de distancia nao e evidencia util de nada —
    // so confunde (visto real 2026-09-11: "6211 min de diferenca" exibido
    // como se fosse um cruzamento, quando na verdade so achou a viagem mais
    // proxima entre varias longe demais pra significar algo). "Dentro da
    // viagem" sempre conta, mesmo se a viagem for longa, ja que o instante
    // realmente caiu dentro do intervalo registrado.
    const MAX_DISTANCIA_MINUTOS = 180;
    const valido = melhor && (melhor.dentroDaViagem || melhor.distanciaMinutos <= MAX_DISTANCIA_MINUTOS);
    result.set(v.id, valido ? melhor! : { enderecoViagem: null, distanciaMinutos: Infinity, dentroDaViagem: false });
  }
  return result;
}

export type MultasFilterOptions = {
  situacoes: string[];
  veiculos: { id: string; plate: string }[];
  condutores: { id: string; name: string }[];
};

// Sem cache (ao contrario de fetchDriverFilterOptions/fetchSindicatoOptions)
// de proposito: o usuario espera ver uma situacao/veiculo novo no filtro
// logo apos rodar "Sincronizar multas", nao ate 5 minutos depois.
export async function fetchMultasFilterOptions(companyId: string): Promise<MultasFilterOptions> {
  const [situacaoRows, veiculoRows, condutorRows] = await Promise.all([
    prisma.multa.findMany({
      where: { companyId, situacaoLw: { not: null } },
      select: { situacaoLw: true },
      distinct: ["situacaoLw"],
    }),
    prisma.vehicle.findMany({
      where: { companyId, multas: { some: {} } },
      select: { id: true, plate: true },
      orderBy: { plate: "asc" },
    }),
    prisma.driver.findMany({
      where: { companyId, indicacoesCondutor: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    situacoes: situacaoRows.map((r) => r.situacaoLw!).sort((a, b) => a.localeCompare(b)),
    veiculos: veiculoRows,
    condutores: condutorRows,
  };
}
