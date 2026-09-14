import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { addDays, differenceInCalendarDays, format, subMonths } from "date-fns";
import { prisma } from "@/lib/prisma";
import { brazilDateStringToUtc, parseLocalDate, utcInstantToLocalParts } from "@/lib/date";
import { extractPlate, platePhysicalVariants } from "@/lib/plate";
import { workedMinutes } from "@/lib/pontoCompliance";
import { cnhAlertLevel } from "@/lib/driverAlerts";
import { resolveCondutorParaMulta } from "@/lib/lw/resolveCondutor";
import { buildCustosMes, parseMes } from "@/lib/custos";
import { buildRiscoMotoristas, RISCO_JANELAS_DIAS } from "@/lib/riscoMotorista";
import { buildHoje } from "@/lib/hoje";
import { buildManutencao, ehCorretiva, OS_STATUS_LABEL, OS_TIPO_LABEL } from "@/lib/manutencao";
import { auditarSofit } from "@/lib/sofit/auditoria";
import { OS_STATUS_ABERTOS } from "@/lib/sofit/manutencaoSync";

// Ferramentas do assistente — TODAS somente leitura e sempre restritas ao
// companyId da sessao (fechado no closure, o modelo nunca escolhe a empresa).
// Cada uma reaproveita a mesma consulta/funcao da tela de origem, pra
// resposta do assistente e numero da tela nunca discordarem. Saidas sao
// compactas (limite de linhas + campos curtos) porque tudo isso vira token.

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use yyyy-MM-dd").describe("Data no formato yyyy-MM-dd");
const HORA = z.string().regex(/^\d{2}:\d{2}$/, "use HH:mm").describe("Hora no formato HH:mm (Brasília)");
const MAX_DIAS_JANELA = 92;

function json(v: unknown): string {
  return JSON.stringify(v);
}
function dia(d: Date): string {
  return format(d, "dd/MM/yyyy");
}
function instante(d: Date): string {
  const p = utcInstantToLocalParts(d.toISOString());
  return p ? `${p.dateISO.split("-").reverse().join("/")} ${p.time}` : "?";
}
function horasMin(min: number | null): string {
  if (min == null) return "em aberto";
  return `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;
}
function brl(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function validarJanela(de: string, ate: string): string | null {
  const a = parseLocalDate(de);
  const b = parseLocalDate(ate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "Datas inválidas.";
  if (b < a) return "A data final é anterior à inicial.";
  if (differenceInCalendarDays(b, a) > MAX_DIAS_JANELA) return `Janela máxima de ${MAX_DIAS_JANELA} dias por consulta — divida o período.`;
  return null;
}
// Escala.date / TimeClockEntry.date sao rotulos de meia-noite (parseLocalDate).
function janelaRotulos(de: string, ate: string) {
  return { gte: parseLocalDate(de), lt: addDays(parseLocalDate(ate), 1) };
}
// VehicleTrip.startAt / FuelTransaction.dataHora sao timestamps reais.
function janelaUtc(de: string, ate: string) {
  return { gte: brazilDateStringToUtc(de), lt: brazilDateStringToUtc(format(addDays(parseLocalDate(ate), 1), "yyyy-MM-dd")) };
}

export function buildAssistenteTools(companyId: string) {
  function placaNormalizada(placaTexto: string): string {
    return extractPlate(placaTexto) ?? placaTexto.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }
  async function resolverVeiculoPorPlaca(placaTexto: string) {
    return prisma.vehicle.findFirst({
      where: { companyId, plate: { in: platePhysicalVariants(placaNormalizada(placaTexto)) } },
      select: { id: true, plate: true, brand: true, model: true, status: true },
    });
  }
  // Filtro de OS por placa que alcanca tanto a OS vinculada ao veiculo quanto
  // a que ficou so com placaOriginal (placa da Sofit que nao casou).
  function filtroPorPlaca(placaTexto: string) {
    const variantes = platePhysicalVariants(placaNormalizada(placaTexto));
    return { OR: [{ vehicle: { plate: { in: variantes } } }, { placaOriginal: { in: variantes } }] };
  }

  const buscarMotoristas = betaZodTool({
    name: "buscar_motoristas",
    description:
      "Localiza motoristas/funcionários pelo nome (parcial, sem acento). Use antes de qualquer consulta por motorista para obter o motoristaId. Retorna até 10.",
    inputSchema: z.object({ nome: z.string().min(2).max(80).describe("Nome ou parte do nome") }),
    run: async ({ nome }) => {
      const palavras = nome.trim().split(/\s+/).filter((p) => p.length > 1);
      const drivers = await prisma.driver.findMany({
        where: { companyId, AND: palavras.map((p) => ({ name: { contains: p, mode: "insensitive" as const } })) },
        select: { id: true, name: true, funcao: true, departamento: true, active: true, cnhCategory: true, cnhExpiration: true },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        take: 10,
      });
      return json(
        drivers.map((d) => ({
          motoristaId: d.id,
          nome: d.name,
          cargo: d.funcao,
          unidade: d.departamento,
          ativo: d.active,
          cnh: d.cnhCategory,
          cnhValidade: d.cnhExpiration ? dia(d.cnhExpiration) : null,
          cnhSituacao: cnhAlertLevel(d.cnhExpiration, d.funcao, d.departamento),
        }))
      );
    },
  });

  const buscarVeiculos = betaZodTool({
    name: "buscar_veiculos",
    description:
      "Localiza veículos pela placa (aceita formato antigo ou Mercosul, com ou sem hífen) ou por parte do modelo. Use para obter o veiculoId. Retorna até 10.",
    inputSchema: z.object({
      placa: z.string().max(20).optional().describe("Placa completa ou parcial"),
      modelo: z.string().max(80).optional().describe("Parte do modelo/marca"),
    }),
    run: async ({ placa, modelo }) => {
      const exato = placa ? await resolverVeiculoPorPlaca(placa) : null;
      const vehicles = exato
        ? [exato]
        : await prisma.vehicle.findMany({
            where: {
              companyId,
              ...(placa ? { plate: { contains: placa.toUpperCase().replace(/[^A-Z0-9]/g, "") } } : {}),
              ...(modelo ? { model: { contains: modelo, mode: "insensitive" as const } } : {}),
            },
            select: { id: true, plate: true, brand: true, model: true, status: true },
            orderBy: { plate: "asc" },
            take: 10,
          });
      return json(vehicles.map((v) => ({ veiculoId: v.id, placa: v.plate, modelo: `${v.brand} ${v.model}`.trim(), status: v.status })));
    },
  });

  const escalas = betaZodTool({
    name: "escalas",
    description: "Escalas planejadas (SIAT) num período, filtrando por motorista e/ou veículo. Traz cliente, rota, horário e veículo. Até 80 linhas.",
    inputSchema: z.object({ motoristaId: z.string().max(64).optional(), veiculoId: z.string().max(64).optional(), de: DATA, ate: DATA }),
    run: async ({ motoristaId, veiculoId, de, ate }) => {
      const erro = validarJanela(de, ate);
      if (erro) return erro;
      const rows = await prisma.escala.findMany({
        where: { companyId, date: janelaRotulos(de, ate), ...(motoristaId ? { driverId: motoristaId } : {}), ...(veiculoId ? { vehicleId: veiculoId } : {}) },
        include: { driver: { select: { name: true } }, vehicle: { select: { plate: true } } },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        take: 80,
      });
      return json({
        total: rows.length,
        escalas: rows.map((e) => ({
          data: dia(e.date),
          inicio: e.startTime,
          fim: e.endTime,
          motorista: e.driver.name,
          placa: e.vehicle?.plate ?? null,
          cliente: e.clientName,
          rota: e.routeName ?? e.scaleName,
          origem: e.fonte ?? "manual",
          tipo: e.requestType,
        })),
      });
    },
  });

  const viagensIturan = betaZodTool({
    name: "viagens_ituran",
    description:
      "Viagens reais do rastreador Ituran de um veículo num período: início/fim, km, velocidade máxima, endereços e o motorista escalado no dia. Até 80 linhas.",
    inputSchema: z.object({ veiculoId: z.string().max(64), de: DATA, ate: DATA }),
    run: async ({ veiculoId, de, ate }) => {
      const erro = validarJanela(de, ate);
      if (erro) return erro;
      const rows = await prisma.vehicleTrip.findMany({
        where: { companyId, vehicleId: veiculoId, startAt: janelaUtc(de, ate) },
        include: { escala: { select: { driver: { select: { name: true } }, clientName: true } } },
        orderBy: { startAt: "asc" },
        take: 80,
      });
      return json({
        total: rows.length,
        kmTotal: Math.round(rows.reduce((s, t) => s + (t.distanceKm ?? 0), 0)),
        viagens: rows.map((t) => ({
          inicio: instante(t.startAt),
          fim: instante(t.endAt),
          km: t.distanceKm != null ? Math.round(t.distanceKm * 10) / 10 : null,
          velMaxKmh: t.maxSpeedKmh,
          ociosoMin: t.idleMinutes,
          saiuDe: t.startAddress,
          chegouEm: t.endAddress,
          motoristaEscalado: t.escala?.driver.name ?? null,
          cliente: t.escala?.clientName ?? null,
        })),
      });
    },
  });

  const ponto = betaZodTool({
    name: "ponto",
    description: "Registros de ponto (TiqueTaque) de um motorista num período, com horas trabalhadas por dia e total. Até 70 dias.",
    inputSchema: z.object({ motoristaId: z.string().max(64), de: DATA, ate: DATA }),
    run: async ({ motoristaId, de, ate }) => {
      const erro = validarJanela(de, ate);
      if (erro) return erro;
      const rows = await prisma.timeClockEntry.findMany({
        where: { companyId, driverId: motoristaId, date: janelaRotulos(de, ate) },
        orderBy: { date: "asc" },
        take: 70,
      });
      let total = 0;
      const dias = rows.map((e) => {
        const w = workedMinutes(e);
        if (w != null) total += w;
        return { data: dia(e.date), entrada: e.clockIn, saida: e.clockOut, horas: horasMin(w), fonte: e.fonte ?? "manual" };
      });
      return json({ diasComPonto: rows.length, horasTotal: horasMin(total), dias });
    },
  });

  const multas = betaZodTool({
    name: "multas",
    description:
      "Multas de trânsito (LW Tecnologia) por veículo e/ou motorista indicado, opcionalmente num período (data da infração). Traz valor, pontos, prazo de indicação e status. Até 50.",
    inputSchema: z.object({ veiculoId: z.string().max(64).optional(), motoristaId: z.string().max(64).optional(), de: DATA.optional(), ate: DATA.optional() }),
    run: async ({ veiculoId, motoristaId, de, ate }) => {
      if (de && ate) {
        const erro = validarJanela(de, ate);
        if (erro) return erro;
      }
      const rows = await prisma.multa.findMany({
        where: {
          companyId,
          ...(veiculoId ? { vehicleId: veiculoId } : {}),
          ...(motoristaId ? { indicacao: { driverId: motoristaId } } : {}),
          ...(de && ate ? { dataInfracao: janelaRotulos(de, ate) } : {}),
        },
        include: { vehicle: { select: { plate: true } }, indicacao: { include: { driver: { select: { name: true } } } } },
        orderBy: { dataInfracao: "desc" },
        take: 50,
      });
      return json({
        total: rows.length,
        valorTotal: brl(rows.reduce((s, m) => s + (m.valorCents ?? 0), 0)),
        multas: rows.map((m) => ({
          placa: m.vehicle?.plate ?? m.placaConsultada,
          data: m.dataInfracao ? dia(m.dataInfracao) : null,
          hora: m.horaInfracao,
          ait: m.ait,
          infracao: m.descricao,
          cidade: m.cidade,
          valor: brl(m.valorCents),
          pontos: m.pontuacao,
          situacaoLw: m.situacaoLw,
          prazoIndicacao: m.dataLimiteIndicacao ? dia(m.dataLimiteIndicacao) : null,
          statusIndicacao: m.indicacao?.status ?? null,
          condutor: m.indicacao?.driver?.name ?? null,
        })),
      });
    },
  });

  const abastecimentos = betaZodTool({
    name: "abastecimentos",
    description: "Abastecimentos (Sofit/Ticket Log) por veículo e/ou motorista num período, com litros, valor, posto e totais. Até 80.",
    inputSchema: z.object({ veiculoId: z.string().max(64).optional(), motoristaId: z.string().max(64).optional(), de: DATA, ate: DATA }),
    run: async ({ veiculoId, motoristaId, de, ate }) => {
      const erro = validarJanela(de, ate);
      if (erro) return erro;
      const rows = await prisma.fuelTransaction.findMany({
        where: { companyId, dataHora: janelaUtc(de, ate), ...(veiculoId ? { vehicleId: veiculoId } : {}), ...(motoristaId ? { driverId: motoristaId } : {}) },
        include: { vehicle: { select: { plate: true } }, driver: { select: { name: true } } },
        orderBy: { dataHora: "desc" },
        take: 80,
      });
      return json({
        total: rows.length,
        litrosTotal: Math.round(rows.reduce((s, f) => s + f.volumeLitros, 0)),
        valorTotal: brl(rows.reduce((s, f) => s + f.valorCents, 0)),
        abastecimentos: rows.map((f) => ({
          quando: instante(f.dataHora),
          placa: f.vehicle?.plate ?? f.placaOriginal,
          motorista: f.driver?.name ?? f.motoristaOriginal,
          litros: Math.round(f.volumeLitros * 10) / 10,
          valor: brl(f.valorCents),
          combustivel: f.combustivel,
          posto: f.posto,
          cidade: f.cidade,
          kmPorLitroSofit: f.realConsumoKmL,
        })),
      });
    },
  });

  const quemEstavaComVeiculo = betaZodTool({
    name: "quem_estava_com_veiculo",
    description:
      "Responde quem estava com um veículo numa data (e hora, se informada): motorista resolvido pela escala do SIAT/uso do veículo, mais todas as escalas e viagens da Ituran daquele dia. Use para multas, ocorrências e conferências.",
    inputSchema: z.object({ placa: z.string().max(20), data: DATA, hora: HORA.optional() }),
    run: async ({ placa, data, hora }) => {
      const v = await resolverVeiculoPorPlaca(placa);
      if (!v) return `Nenhum veículo cadastrado com a placa ${placa}.`;
      const dataLabel = parseLocalDate(data);
      const [resolvido, escalasDia, viagensDia] = await Promise.all([
        resolveCondutorParaMulta({ vehicleId: v.id, dataInfracao: dataLabel, horaInfracao: hora ?? null }),
        prisma.escala.findMany({
          where: { companyId, vehicleId: v.id, date: dataLabel },
          include: { driver: { select: { id: true, name: true } } },
          orderBy: { startTime: "asc" },
        }),
        prisma.vehicleTrip.findMany({
          where: { companyId, vehicleId: v.id, startAt: janelaUtc(data, data) },
          orderBy: { startAt: "asc" },
          take: 40,
        }),
      ]);
      const nomeResolvido = resolvido.driverId
        ? (await prisma.driver.findUnique({ where: { id: resolvido.driverId }, select: { name: true } }))?.name ?? null
        : null;
      return json({
        veiculo: { veiculoId: v.id, placa: v.plate, modelo: `${v.brand} ${v.model}`.trim() },
        motoristaResolvido: nomeResolvido
          ? { motoristaId: resolvido.driverId, nome: nomeResolvido, origem: resolvido.origem, candidatos: resolvido.candidatos }
          : { nome: null, motivo: resolvido.candidatos > 1 ? "mais de um motorista escalado nesse horário" : "nenhuma escala/uso cobrindo esse horário" },
        escalasDoDia: escalasDia.map((e) => ({ motoristaId: e.driver.id, motorista: e.driver.name, inicio: e.startTime, fim: e.endTime, cliente: e.clientName, rota: e.routeName })),
        viagensIturanDoDia: viagensDia.map((t) => ({ inicio: instante(t.startAt), fim: instante(t.endAt), km: t.distanceKm, saiuDe: t.startAddress, chegouEm: t.endAddress })),
      });
    },
  });

  const custosDoMes = betaZodTool({
    name: "custos_do_mes",
    description:
      "Custo operacional de um mês (combustível + multas + mão de obra) com km da Ituran e R$/km, total e por cliente/veículo (top 10 de cada). Mesmo cálculo da tela Custos.",
    inputSchema: z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/).describe("Mês no formato yyyy-MM") }),
    run: async ({ mes }) => {
      const c = await buildCustosMes(companyId, parseMes(mes));
      const rKm = (cents: number | null) => (cents == null ? null : `${brl(cents)}/km`);
      return json({
        mes,
        totais: {
          custoTotal: brl(c.totais.totalCents),
          combustivel: brl(c.totais.combustivelCents),
          litros: Math.round(c.totais.litros),
          multas: brl(c.totais.multasCents),
          maoDeObra: brl(c.totais.maoDeObraCents),
          km: c.totais.km,
          custoPorKm: rKm(c.totais.km > 0 ? c.totais.totalCents / c.totais.km : null),
          kmPorLitro: c.totais.km > 0 && c.totais.litros > 0 ? Math.round((c.totais.km / c.totais.litros) * 100) / 100 : null,
          horasMotorista: horasMin(c.totais.horasMin),
        },
        topClientes: c.clientes.slice(0, 10).map((x) => ({ cliente: x.nome, km: x.km, total: brl(x.totalCents), custoPorKm: rKm(x.custoPorKmCents), veiculos: x.veiculos })),
        topVeiculos: c.veiculos.slice(0, 10).map((x) => ({ placa: x.plate, km: x.km, total: brl(x.totalCents), custoPorKm: rKm(x.custoPorKmCents), kmPorLitro: x.kmPorLitro ? Math.round(x.kmPorLitro * 100) / 100 : null })),
      });
    },
  });

  const riscoMotoristas = betaZodTool({
    name: "risco_motoristas",
    description: "Ranking de risco por motorista (CNH, multas/pontos, condução Ituran, descanso entre turnos, faltas) nos últimos 30, 60 ou 90 dias. Top 15. Mesmo cálculo da tela Risco por motorista.",
    inputSchema: z.object({ dias: z.number().int().optional().describe("30, 60 ou 90 (padrão 30)") }),
    run: async ({ dias }) => {
      const d = (RISCO_JANELAS_DIAS as readonly number[]).includes(dias ?? 30) ? (dias ?? 30) : 30;
      const r = await buildRiscoMotoristas(companyId, d);
      return json({
        dias: d,
        totais: r.totais,
        ranking: r.motoristas.filter((m) => m.score > 0).slice(0, 15).map((m) => ({ motoristaId: m.driverId, nome: m.driverName, nivel: m.nivel, score: m.score, motivos: m.motivos })),
      });
    },
  });

  const pendenciasHoje = betaZodTool({
    name: "pendencias_hoje",
    description: "Resumo do painel Hoje: multas com prazo, CNH, escala x ponto de ontem, veículo escalado sem viagem, cartões, integrações, manutenção e afastados.",
    inputSchema: z.object({}),
    run: async () => {
      const h = await buildHoje(companyId);
      return json({
        urgentes: h.urgentes,
        avisos: h.avisos,
        escalasHoje: h.resumo,
        multasPrazo: { vencendo: h.multas.vencendo, vencidas: h.multas.vencidas, itens: h.multas.itens.map((m) => ({ placa: m.placa, ait: m.ait, prazo: dia(m.dataLimiteIndicacao), condutor: m.condutorSugerido })) },
        cnh: { vencidas: h.cnh.vencidas, venceEmBreve: h.cnh.venceEmBreve, itens: h.cnh.itens.map((c) => ({ nome: c.driverName, nivel: c.nivel, proximaViagem: c.proximaViagem ? dia(c.proximaViagem.date) : null })) },
        escalaXPontoOntem: { semAfastamento: h.excecoesOntem.semAfastamento, itens: h.excecoesOntem.itens.map((e) => ({ nome: e.driverName, tipo: e.tipo, afastamento: e.afastamento })) },
        escaladoSemViagemOntem: { ituranSemDados: h.escalaSemViagem.ituranSemDadosOntem, itens: h.escalaSemViagem.itens.map((v) => ({ placa: v.plate, motoristas: v.motoristas })) },
        cartoes: h.cartoes.map((c) => ({ placa: c.plate, situacao: c.situacao, saldo: brl(c.saldoCents) })),
        integracoesSemDados: h.integracoes.map((i) => ({ sistema: i.sistema, diasFaltando: i.missingDays })),
        manutencaoPendente: h.manutencao.map((m) => ({ placa: m.plate, kmDesde: m.kmDesde })),
        afastadosHoje: h.afastadosHoje.map((a) => ({ nome: a.driverName, tipo: a.tipo, ate: dia(a.ate) })),
      });
    },
  });

  const afastamentos = betaZodTool({
    name: "afastamentos",
    description: "Afastamentos (férias, atestado, folga, abono) que tocam um período, opcionalmente de um motorista. Até 80.",
    inputSchema: z.object({ motoristaId: z.string().max(64).optional(), de: DATA, ate: DATA }),
    run: async ({ motoristaId, de, ate }) => {
      const erro = validarJanela(de, ate);
      if (erro) return erro;
      const rows = await prisma.driverLeave.findMany({
        where: { companyId, startDate: { lte: parseLocalDate(ate) }, endDate: { gte: parseLocalDate(de) }, ...(motoristaId ? { driverId: motoristaId } : {}) },
        include: { driver: { select: { name: true } } },
        orderBy: { startDate: "asc" },
        take: 80,
      });
      return json(rows.map((l) => ({ motorista: l.driver.name, tipo: l.leaveType, de: dia(l.startDate), ate: dia(l.endDate), detalhes: l.details })));
    },
  });

  // --- Manutencao (espelho da Sofit) ---
  const manutencaoResumo = betaZodTool({
    name: "manutencao_resumo",
    description:
      "Visão executiva da manutenção (Sofit): frota disponível × em manutenção, OS abertas por status e idade, o que cobrar da equipe, aderência ao plano, preventiva × corretiva por mês, causas das corretivas, reincidentes, vencimentos. Mesmo cálculo da tela Manutenção.",
    inputSchema: z.object({}),
    run: async () => {
      const m = await buildManutencao(companyId);
      return json({
        ultimaSincronizacao: m.ultimaSync ? instante(m.ultimaSync) : null,
        frota: m.frota,
        osAbertas: { total: m.backlog.total, porStatus: m.backlog.porStatus, haMaisDe30Dias: m.backlog.antigas, preventivasAguardandoAprovacaoMais7d: m.backlog.aprovacaoAtrasada },
        paraCobrar: m.higiene,
        aderenciaPlano: { vencidas: m.aderencia.vencidas, venceEmBreve: m.aderencia.breve, emDia: m.aderencia.emDia, semHistorico: m.aderencia.semHistorico },
        mensal: m.mensal,
        corretivasPorVeiculoAtivo: m.corretivasPorVeiculo,
        causasCorretivas90d: m.causas.slice(0, 8),
        reincidentes90d: m.reincidentes.slice(0, 8),
        fornecedores90d: m.fornecedores.slice(0, 5),
        vencimentos: { vencidos: m.vencimentos.vencidos.length, proximos60d: m.vencimentos.proximos.length },
        paradosAgora: m.parados.slice(0, 10).map((p) => ({ placa: p.plate, modelo: p.modelo, osAberta: p.osAberta ? `${p.osAberta.numero} há ${p.osAberta.idadeDias}d` : "sem OS aberta" })),
      });
    },
  });

  const osAbertas = betaZodTool({
    name: "os_abertas",
    description:
      "Ordens de serviço abertas na Sofit (aguardando aprovação, planejada, em andamento, aguardando NF), com filtros por status, idade mínima em dias e placa. Mais antigas primeiro. Até 50.",
    inputSchema: z.object({
      status: z.enum(["underApproval", "planned", "inProgress", "waitingNf"]).optional(),
      diasMinimo: z.number().int().min(0).optional().describe("Só OS abertas há pelo menos N dias"),
      placa: z.string().max(20).optional(),
    }),
    run: async ({ status, diasMinimo, placa }) => {
      // Tambem por placaOriginal: OS da Sofit cuja placa nao casou com a frota
      // (ver auditoria "os_sem_veiculo") ainda precisa aparecer ao perguntar
      // por essa placa.
      const filtroPlaca = placa ? filtroPorPlaca(placa) : null;
      const rows = await prisma.ordemServico.findMany({
        where: {
          companyId,
          status: status ? status : { in: [...OS_STATUS_ABERTOS] },
          ...(filtroPlaca ?? {}),
          ...(diasMinimo ? { criadaEm: { lte: new Date(Date.now() - diasMinimo * 86_400_000) } } : {}),
        },
        include: { vehicle: { select: { plate: true } } },
        orderBy: { criadaEm: "asc" },
        take: 50,
      });
      const agora = new Date();
      return json({
        total: rows.length,
        os: rows.map((o) => ({
          os: o.numero,
          placa: o.vehicle?.plate ?? o.placaOriginal,
          tipo: OS_TIPO_LABEL[o.tipo ?? ""] ?? o.tipo,
          status: OS_STATUS_LABEL[o.status ?? ""] ?? o.status,
          abertaEm: dia(o.criadaEm),
          dias: differenceInCalendarDays(agora, o.criadaEm),
          previsao: o.previsaoFimEm ? dia(o.previsaoFimEm) : null,
          fornecedor: o.fornecedor,
          problema: o.problema?.split("\n")[0]?.slice(0, 100) ?? null,
        })),
      });
    },
  });

  const veiculosParados = betaZodTool({
    name: "veiculos_parados",
    description: "Veículos marcados 'em manutenção' na Sofit agora, com a OS aberta e há quantos dias; filtro por idade mínima da OS (ou só os sem OS aberta).",
    inputSchema: z.object({ diasMinimo: z.number().int().min(0).optional(), somenteSemOs: z.boolean().optional() }),
    run: async ({ diasMinimo, somenteSemOs }) => {
      const m = await buildManutencao(companyId);
      const lista = m.parados.filter((p) => (somenteSemOs ? !p.osAberta : true) && (diasMinimo ? (p.osAberta?.idadeDias ?? 0) >= diasMinimo : true));
      return json({
        emManutencaoAgora: m.frota.emManutencao,
        semOsAberta: m.higiene.paradosSemOs,
        filtrados: lista.length,
        veiculos: lista.slice(0, 60).map((p) => ({
          placa: p.plate,
          modelo: p.modelo,
          os: p.osAberta?.numero ?? null,
          tipo: p.osAberta ? (OS_TIPO_LABEL[p.osAberta.tipo ?? ""] ?? p.osAberta.tipo) : null,
          status: p.osAberta ? (OS_STATUS_LABEL[p.osAberta.status ?? ""] ?? p.osAberta.status) : "sem OS aberta",
          diasParado: p.osAberta?.idadeDias ?? null,
          problema: p.osAberta?.problema?.split("\n")[0]?.slice(0, 100) ?? null,
        })),
      });
    },
  });

  const aderenciaPlano = betaZodTool({
    name: "aderencia_plano",
    description: "Aderência ao plano de manutenção por veículo: km e dias desde a última revisão concluída contra o intervalo cadastrado na Sofit. Filtro por situação (vencida, breve, em_dia, sem_historico) e placa. Até 40.",
    inputSchema: z.object({ situacao: z.enum(["vencida", "breve", "em_dia", "sem_historico"]).optional(), placa: z.string().max(20).optional() }),
    run: async ({ situacao, placa }) => {
      const veiculo = placa ? await resolverVeiculoPorPlaca(placa) : null;
      if (placa && !veiculo) return `Nenhum veículo cadastrado com a placa ${placa}.`;
      const m = await buildManutencao(companyId);
      const lista = m.aderencia.itens.filter((a) => (!situacao || a.situacao === situacao) && (!veiculo || a.vehicleId === veiculo.id));
      if (veiculo && lista.length === 0) return `${veiculo.plate} não entra na aderência ao plano: sem intervalo de manutenção cadastrado na Sofit ou inativo lá.`;
      return json({
        totais: { vencidas: m.aderencia.vencidas, venceEmBreve: m.aderencia.breve, emDia: m.aderencia.emDia, semHistorico: m.aderencia.semHistorico },
        filtrados: lista.length,
        veiculos: lista.slice(0, 40).map((a) => ({
          placa: a.plate,
          modelo: a.modelo,
          situacao: a.situacao,
          percentualDoIntervalo: a.pct != null ? Math.round(a.pct * 100) : null,
          kmAtual: a.kmAtual,
          kmDesdeUltimaRevisao: a.kmDesde,
          intervaloKm: a.intervaloKm,
          diasDesdeUltimaRevisao: a.diasDesde,
          intervaloDias: a.intervaloDias,
          ultimaRevisao: a.ultimaEm ? dia(a.ultimaEm) : null,
          disponibilidadeAgora: a.disponibilidade,
        })),
      });
    },
  });

  const historicoManutencao = betaZodTool({
    name: "historico_manutencao_veiculo",
    description: "Histórico de ordens de serviço de um veículo na Sofit (padrão: últimos 12 meses): tipo, status, datas, dias parado, hodômetro, fornecedor e problema. Até 60.",
    inputSchema: z.object({ placa: z.string().max(20), meses: z.number().int().min(1).max(36).optional() }),
    run: async ({ placa, meses }) => {
      const v = await resolverVeiculoPorPlaca(placa);
      const desde = subMonths(new Date(), meses ?? 12);
      const rows = await prisma.ordemServico.findMany({ where: { companyId, ...filtroPorPlaca(placa), criadaEm: { gte: desde } }, orderBy: { criadaEm: "desc" }, take: 60 });
      if (!v && rows.length === 0) return `Nenhum veículo cadastrado com a placa ${placa} e nenhuma OS da Sofit com essa placa.`;
      const corretivas = rows.filter((o) => ehCorretiva(o.tipo)).length;
      return json({
        veiculo: v ? { placa: v.plate, modelo: `${v.brand} ${v.model}`.trim() } : { placa: placaNormalizada(placa), aviso: "placa não está na frota cadastrada — OS vindas só da Sofit" },
        periodoMeses: meses ?? 12,
        totalOs: rows.length,
        corretivas,
        preventivas: rows.filter((o) => o.tipo === "preventive").length,
        diasParadoTotal: Math.round(rows.reduce((s, o) => s + (o.diasParado ?? 0), 0)),
        os: rows.map((o) => ({
          os: o.numero,
          tipo: OS_TIPO_LABEL[o.tipo ?? ""] ?? o.tipo,
          status: OS_STATUS_LABEL[o.status ?? ""] ?? o.status,
          abertaEm: dia(o.criadaEm),
          concluidaEm: o.fimEm ? dia(o.fimEm) : null,
          diasParado: o.diasParado,
          hodometro: o.hodometroFinal,
          fornecedor: o.fornecedor,
          problema: o.problema?.split("\n")[0]?.slice(0, 120) ?? null,
        })),
      });
    },
  });

  const auditoriaSofit = betaZodTool({
    name: "auditoria_sofit",
    description:
      "Auditoria de qualidade dos dados da Sofit: sem parâmetro lista os itens (chave, título, gravidade, quantidade); com `item` devolve as linhas daquele item (até 50). Chaves: hodometro_implausivel, km_por_ano, odometro_divergente, os_hodometro, os_antiga, preventiva_aprovacao, parado_sem_os, os_aberta_disponivel, os_sem_veiculo, revisao_como_corretiva, os_sem_hodometro, os_dias_parado, vencimento_antigo, sem_intervalo, frota_sem_sofit, status_divergente, km_baixo_idade.",
    inputSchema: z.object({ item: z.string().max(80).optional() }),
    run: async ({ item }) => {
      const a = await auditarSofit(companyId);
      if (!item) {
        return json({
          geradoEm: instante(a.geradoEm),
          totalApontamentos: a.totalLinhas,
          porGravidade: a.porGravidade,
          itens: a.achados.map((x) => ({ chave: x.chave, titulo: x.titulo, gravidade: x.gravidade, quantidade: x.linhas.length, oQueFazer: x.oQueFazer })),
        });
      }
      const ach = a.achados.find((x) => x.chave === item);
      if (!ach) return `Item "${item}" não existe ou não tem apontamentos no momento.`;
      return json({ chave: ach.chave, titulo: ach.titulo, gravidade: ach.gravidade, oQueFazer: ach.oQueFazer, total: ach.linhas.length, linhas: ach.linhas.slice(0, 50) });
    },
  });

  return [
    buscarMotoristas,
    buscarVeiculos,
    quemEstavaComVeiculo,
    escalas,
    viagensIturan,
    ponto,
    multas,
    abastecimentos,
    afastamentos,
    custosDoMes,
    riscoMotoristas,
    pendenciasHoje,
    manutencaoResumo,
    osAbertas,
    veiculosParados,
    aderenciaPlano,
    historicoManutencao,
    auditoriaSofit,
  ];
}

export { FERRAMENTA_LABEL } from "./labels";
