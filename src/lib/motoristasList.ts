import { prisma } from "@/lib/prisma";
import { cnhAlertLevel, type CnhAlertLevel } from "@/lib/driverAlerts";
import type { Prisma } from "@prisma/client";

export const CNH_STATUS_OPTIONS: { value: CnhAlertLevel; label: string }[] = [
  { value: "vencida", label: "CNH vencida" },
  { value: "vence_em_breve", label: "CNH vence em 30 dias" },
  { value: "pendente", label: "CNH pendente" },
  { value: "ok", label: "CNH em dia" },
  { value: "nao_aplicavel", label: "Não exige CNH" },
];

export const MOTORISTA_SORT_FIELDS = [
  "name",
  "cpf",
  "sindicato",
  "cnhExpiration",
  "empregador",
  "departamento",
  "funcao",
  "regimeHoras",
  "escalaSemanal",
] as const;
export type MotoristaSortField = (typeof MOTORISTA_SORT_FIELDS)[number];

export type MotoristasFilters = {
  q?: string;
  sindicatoId: string[];
  status?: string;
  empregador: string[];
  departamento: string[];
  cargo: string[];
  escala?: string;
  // Nao e coluna do banco (cnhAlertLevel depende de funcao/departamento pra
  // decidir se o cargo exige CNH, ver driverAlerts.ts) — filtrado em memoria
  // depois da query, nao no `where` do Prisma.
  cnhStatus?: string;
};

export function buildMotoristasWhere(companyId: string, filters: MotoristasFilters): Prisma.DriverWhereInput {
  const where: Prisma.DriverWhereInput = { companyId };
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: "insensitive" } },
      { cpf: { contains: filters.q } },
    ];
  }
  if (filters.sindicatoId.length > 0) where.sindicatoId = { in: filters.sindicatoId };
  if (filters.status === "ativo") where.active = true;
  if (filters.status === "inativo") where.active = false;
  if (filters.empregador.length > 0) where.empregador = { in: filters.empregador };
  if (filters.departamento.length > 0) where.departamento = { in: filters.departamento };
  if (filters.cargo.length > 0) where.funcao = { in: filters.cargo };
  if (filters.escala === "SEIS_UM" || filters.escala === "CINCO_DOIS") where.escalaSemanal = filters.escala;
  return where;
}

export function buildMotoristasOrderBy(
  sortField: MotoristaSortField,
  sortDir: "asc" | "desc"
): Prisma.DriverOrderByWithRelationInput {
  switch (sortField) {
    case "sindicato":
      return { sindicato: { nome: sortDir } };
    case "cnhExpiration":
      return { cnhExpiration: { sort: sortDir, nulls: "last" } };
    case "cpf":
      return { cpf: sortDir };
    case "empregador":
      return { empregador: { sort: sortDir, nulls: "last" } };
    case "departamento":
      return { departamento: { sort: sortDir, nulls: "last" } };
    case "funcao":
      return { funcao: { sort: sortDir, nulls: "last" } };
    case "regimeHoras":
      return { regimeHoras: { sort: sortDir, nulls: "last" } };
    case "escalaSemanal":
      return { escalaSemanal: { sort: sortDir, nulls: "last" } };
    default:
      return { name: sortDir };
  }
}

// Usado tanto pela tela quanto pela exportacao, pra garantir que o arquivo
// exportado reflita exatamente os mesmos filtros/ordenacao vistos na tela.
export async function fetchMotoristasList(
  companyId: string,
  filters: MotoristasFilters,
  sortField: MotoristaSortField,
  sortDir: "asc" | "desc"
) {
  const drivers = await prisma.driver.findMany({
    where: buildMotoristasWhere(companyId, filters),
    include: { sindicato: true },
    orderBy: buildMotoristasOrderBy(sortField, sortDir),
  });
  if (!filters.cnhStatus) return drivers;
  return drivers.filter((d) => cnhAlertLevel(d.cnhExpiration, d.funcao, d.departamento) === filters.cnhStatus);
}
