import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { brazilDateStringToUtc, parseLocalDate, utcInstantToLocalParts } from "@/lib/date";
import { extractPlate, platePhysicalVariants } from "@/lib/plate";
import { workedMinutes } from "@/lib/pontoCompliance";
import { cnhAlertLevel } from "@/lib/driverAlerts";
import { resolveCondutorParaMulta } from "@/lib/lw/resolveCondutor";
import { buildCustosMes, parseMes } from "@/lib/custos";
import { buildRiscoMotoristas, RISCO_JANELAS_DIAS } from "@/lib/riscoMotorista";
import { buildHoje } from "@/lib/hoje";

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
  async function resolverVeiculoPorPlaca(placaTexto: string) {
    const placa = extractPlate(placaTexto) ?? placaTexto.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return prisma.vehicle.findFirst({
      where: { companyId, plate: { in: platePhysicalVariants(placa) } },
      select: { id: true, plate: true, brand: true, model: true, status: true },
    });
  }

  const buscarMotoristas = betaZodTool({
    name: "buscar_motoristas",
    description:
      "Localiza motoristas/funcionários pelo nome (parcial, sem acento). Use antes de qualquer consulta por motorista para obter o motoristaId. Retorna até 10.",
    inputSchema: z.object({ nome: z.string().min(2).describe("Nome ou parte do nome") }),
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
      placa: z.string().optional().describe("Placa completa ou parcial"),
      modelo: z.string().optional().describe("Parte do modelo/marca"),
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
    inputSchema: z.object({ motoristaId: z.string().optional(), veiculoId: z.string().optional(), de: DATA, ate: DATA }),
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
    inputSchema: z.object({ veiculoId: z.string(), de: DATA, ate: DATA }),
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
    inputSchema: z.object({ motoristaId: z.string(), de: DATA, ate: DATA }),
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
    inputSchema: z.object({ veiculoId: z.string().optional(), motoristaId: z.string().optional(), de: DATA.optional(), ate: DATA.optional() }),
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
    inputSchema: z.object({ veiculoId: z.string().optional(), motoristaId: z.string().optional(), de: DATA, ate: DATA }),
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
    inputSchema: z.object({ placa: z.string(), data: DATA, hora: HORA.optional() }),
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
    inputSchema: z.object({ motoristaId: z.string().optional(), de: DATA, ate: DATA }),
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
  ];
}

export const FERRAMENTA_LABEL: Record<string, string> = {
  buscar_motoristas: "motoristas",
  buscar_veiculos: "veículos",
  quem_estava_com_veiculo: "quem estava com o veículo",
  escalas: "escalas (SIAT)",
  viagens_ituran: "viagens (Ituran)",
  ponto: "ponto",
  multas: "multas",
  abastecimentos: "abastecimentos",
  afastamentos: "afastamentos",
  custos_do_mes: "custos do mês",
  risco_motoristas: "risco por motorista",
  pendencias_hoje: "painel Hoje",
};
