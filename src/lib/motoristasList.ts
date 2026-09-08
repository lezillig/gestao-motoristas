import { unstable_cache } from "next/cache";
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
  // depois da query, nao no `where` do Prisma. Multi-selecao (filtro estilo
  // Excel), por isso lista em vez de valor unico.
  cnhStatus: string[];
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
  if (filters.cnhStatus.length === 0) return drivers;
  return drivers.filter((d) => filters.cnhStatus.includes(cnhAlertLevel(d.cnhExpiration, d.funcao, d.departamento)));
}

export type DriverFilterOptions = { empregadores: string[]; departamentos: string[]; cargos: string[] };

// Empregador/departamento/cargo dos dropdowns de filtro (Motoristas E
// Ponto x Escala usam exatamente as mesmas 3 consultas "distinct" sobre
// Driver) — esses valores só mudam quando alguém importa uma planilha
// nova ou edita um cadastro, então repetir as 3 consultas em toda visita
// a qualquer uma das duas telas era trabalho refeito à toa. 5 minutos de
// cache: folgado o bastante pra eliminar quase toda repetição, curto o
// bastante pra um cargo novo aparecer no filtro logo depois de importado.
export const fetchDriverFilterOptions = unstable_cache(
  async (companyId: string): Promise<DriverFilterOptions> => {
    const [empregadorRows, departamentoRows, cargoRows] = await Promise.all([
      prisma.driver.findMany({
        where: { companyId, empregador: { not: null } },
        select: { empregador: true },
        distinct: ["empregador"],
        orderBy: { empregador: "asc" },
      }),
      prisma.driver.findMany({
        where: { companyId, departamento: { not: null } },
        select: { departamento: true },
        distinct: ["departamento"],
        orderBy: { departamento: "asc" },
      }),
      prisma.driver.findMany({
        where: { companyId, funcao: { not: null } },
        select: { funcao: true },
        distinct: ["funcao"],
        orderBy: { funcao: "asc" },
      }),
    ]);
    return {
      empregadores: empregadorRows.map((r) => r.empregador!).sort((a, b) => a.localeCompare(b)),
      departamentos: departamentoRows.map((r) => r.departamento!).sort((a, b) => a.localeCompare(b)),
      cargos: cargoRows.map((r) => r.funcao!).sort((a, b) => a.localeCompare(b)),
    };
  },
  ["driver-filter-options"],
  { revalidate: 300 }
);

export type SindicatoOption = { id: string; nome: string };

// Só a lista pro dropdown de filtro (id+nome) — não confundir com a
// consulta do Painel, que traz _count de motoristas por sindicato e por
// isso NÃO pode usar esse cache (contagem precisa estar sempre atual).
export const fetchSindicatoOptions = unstable_cache(
  async (companyId: string): Promise<SindicatoOption[]> => {
    const rows = await prisma.sindicato.findMany({
      where: { companyId, active: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    });
    return rows;
  },
  ["sindicato-options"],
  { revalidate: 300 }
);
