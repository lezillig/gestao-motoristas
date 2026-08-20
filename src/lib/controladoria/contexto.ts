import type { ControladoriaConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import type { ContextoAuditoria } from "./types";
import { inicioDoDia, somarDias } from "./periodos";

// Data a partir da qual a base historica e carregada.
//
// O pedido original era 01/01/2026, mas sem o ano anterior na base TODA
// comparacao ano-contra-ano do relatorio sai como "sem base comparativa" —
// e comparativo anual foi um dos pedidos explicitos. Com 2025 carregado, o
// primeiro relatorio ja nasce com YoY real (decisao confirmada com o
// usuario). O ciclo diario continua sendo D-1; 2025/2026 entram uma unica
// vez pelo backfill encadeado, em segundo plano.
const DATA_INICIO_PADRAO = process.env.OMIE_DATA_INICIO_BASE ?? "2025-01-01";

// Destinatario definido pelo usuario. Fica como PADRAO do cadastro, nao como
// destino fixo no codigo: quem recebe relatorio gerencial muda (entra o
// contador, sai um socio) e isso nao pode exigir deploy.
const EMAILS_PADRAO = process.env.RELATORIO_EMAILS ?? "leandro.zillig@azulmob.com.br";

export async function garantirConfig(companyId: string): Promise<ControladoriaConfig> {
  const existente = await prisma.controladoriaConfig.findUnique({ where: { companyId } });
  if (existente) return existente;

  return prisma.controladoriaConfig.create({
    data: {
      companyId,
      emailsRelatorio: EMAILS_PADRAO,
      dataInicioBase: parseLocalDate(DATA_INICIO_PADRAO),
    },
  });
}

export function destinatarios(config: ControladoriaConfig): string[] {
  return config.emailsRelatorio
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
}

// Carrega tudo que os agentes precisam numa leitura so. O recorte e sempre
// >= config.dataInicioBase: alem de limitar o volume, e o que garante que
// nenhum agente compare "ano atual" contra um ano anterior parcialmente
// carregado e conclua uma queda que so existe na base.
export async function carregarContexto(
  companyId: string,
  dataReferencia: Date
): Promise<ContextoAuditoria> {
  const config = await garantirConfig(companyId);
  const desde = inicioDoDia(config.dataInicioBase);
  // Movimento/abastecimento sao usados so em janelas recentes (conciliacao,
  // custo do mes, comparativo com o mes anterior). Carregar desde o inicio
  // da base ai seria peso morto no maior volume da tabela.
  const desdeRecente = somarDias(inicioDoDia(dataReferencia), -400);
  const corteRecente = desdeRecente > desde ? desdeRecente : desde;

  const [
    titulos,
    baixas,
    movimentos,
    notas,
    parceiros,
    categorias,
    departamentos,
    contasCorrentes,
    vinculos,
    motoristas,
    clientes,
    veiculos,
    abastecimentos,
    pontos,
    ultimoSyncConcluido,
  ] = await Promise.all([
    prisma.omieTitulo.findMany({
      where: { companyId, OR: [{ dataVencimento: { gte: desde } }, { dataEmissao: { gte: desde } }] },
      orderBy: { dataVencimento: "asc" },
    }),
    prisma.omieBaixa.findMany({ where: { companyId, dataBaixa: { gte: desde } }, orderBy: { dataBaixa: "asc" } }),
    prisma.omieMovimento.findMany({ where: { companyId, data: { gte: corteRecente } }, orderBy: { data: "asc" } }),
    prisma.omieNota.findMany({ where: { companyId, dataEmissao: { gte: desde } }, orderBy: { dataEmissao: "asc" } }),
    prisma.omieParceiro.findMany({ where: { companyId } }),
    prisma.omieCategoria.findMany({ where: { companyId } }),
    prisma.omieDepartamento.findMany({ where: { companyId } }),
    prisma.omieContaCorrente.findMany({ where: { companyId } }),
    prisma.omieVinculoCentroCusto.findMany({ where: { companyId } }),
    prisma.driver.findMany({
      where: { companyId },
      select: { id: true, name: true, cpf: true, active: true, valorHoraCents: true, clienteId: true, departamento: true },
    }),
    prisma.cliente.findMany({ where: { companyId }, select: { id: true, nome: true, active: true } }),
    prisma.vehicle.findMany({
      where: { companyId },
      select: { id: true, plate: true, status: true, currentMileage: true },
    }),
    prisma.fuelTransaction.findMany({ where: { companyId, dataHora: { gte: corteRecente } } }),
    prisma.timeClockEntry.findMany({
      where: { companyId, date: { gte: corteRecente } },
      select: { id: true, driverId: true, date: true },
    }),
    prisma.omieSyncRun.findFirst({
      where: { companyId, status: "CONCLUIDO", backfill: false },
      orderBy: { finalizadoEm: "desc" },
    }),
  ]);

  return {
    companyId,
    agora: new Date(),
    dataReferencia: inicioDoDia(dataReferencia),
    config,
    titulos,
    baixas,
    movimentos,
    notas,
    parceiros,
    categorias,
    departamentos,
    contasCorrentes,
    vinculos,
    motoristas,
    clientes,
    veiculos,
    abastecimentos,
    pontos,
    ultimoSyncConcluido,
  };
}
