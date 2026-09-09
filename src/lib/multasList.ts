import { prisma } from "@/lib/prisma";
import type { Prisma, StatusIndicacaoCondutor } from "@prisma/client";

export const MULTA_SORT_FIELDS = [
  "placa",
  "dataInfracao",
  "situacaoLw",
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
    case "situacaoLw":
      return { situacaoLw: { sort: sortDir, nulls: "last" } };
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

// Usado tanto pela tela quanto pela exportacao, mesmo espirito de
// fetchMotoristasList — garante que o arquivo exportado reflita
// exatamente os mesmos filtros/ordenacao vistos na tela.
export async function fetchMultasList(companyId: string, filters: MultasFilters, sortField: MultaSortField, sortDir: "asc" | "desc") {
  return prisma.multa.findMany({
    where: buildMultasWhere(companyId, filters),
    include: {
      vehicle: { select: { plate: true } },
      indicacao: { include: { driver: { select: { id: true, name: true, cpf: true, cnh: true } } } },
    },
    orderBy: buildMultasOrderBy(sortField, sortDir),
  });
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
