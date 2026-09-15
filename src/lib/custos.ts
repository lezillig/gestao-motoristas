import { addMonths, format, startOfMonth } from "date-fns";
import { prisma } from "@/lib/prisma";
import { brazilDateStringToUtc } from "@/lib/date";
import { platePhysicalVariants } from "@/lib/plate";
import { workedMinutes } from "@/lib/pontoCompliance";
import { ADICIONAL_NOTURNO_PERCENTUAL_MINIMO, HORA_EXTRA_PERCENTUAL_MINIMO, resolveRegra } from "@/lib/convencao";
import { mesParam } from "@/lib/params";

export const SEM_ESCALA = "Sem escala no SIAT";
export const SEM_CLIENTE = "Sem cliente (plantão)";

type Acumulado = {
  km: number;
  viagens: number;
  litros: number;
  combustivelCents: number;
  multasCents: number;
  multasQtd: number;
  horasMin: number;
  maoDeObraCents: number;
  semValorHora: boolean;
  escalaDias: number;
};

export type CustoVeiculo = Acumulado & {
  vehicleId: string;
  plate: string;
  modelo: string;
  viagensSemEscala: number;
  clientes: string[];
  totalCents: number;
  custoPorKmCents: number | null;
  combustivelPorKmCents: number | null;
  kmPorLitro: number | null;
};

export type CustoCliente = Acumulado & {
  nome: string;
  veiculos: number;
  motoristas: number;
  totalCents: number;
  custoPorKmCents: number | null;
  custoPorHoraCents: number | null;
};

export type MaoDeObraResumo = {
  encargosPercentual: number | null;
  baseCents: number;
  he50Cents: number;
  he100Cents: number;
  noturnoCents: number;
  encargosCents: number;
  totalCents: number;
  horasNormais: number;
  horasExtra50: number;
  horasExtra100: number;
  motoristasComEspelho: number;
  motoristasSemEspelho: number;
  motoristasSemValorHora: number;
};

export type CustosMes = {
  monthStart: Date;
  veiculos: CustoVeiculo[];
  clientes: CustoCliente[];
  maoDeObra: MaoDeObraResumo;
  // OS da Sofit concluidas no mes e quantas tem valor lancado. A manutencao
  // ainda NAO entra no total: so quando a cobertura for confiavel.
  manutencao: { osConcluidas: number; osComCusto: number; custoLancadoCents: number };
  totais: {
    combustivelCents: number;
    litros: number;
    multasCents: number;
    multasQtd: number;
    km: number;
    viagens: number;
    viagensSemEscala: number;
    horasMin: number;
    maoDeObraCents: number;
    combustivelSemVeiculoCents: number;
    multasSemVeiculoCents: number;
    totalCents: number;
  };
};

function novoAcumulado(): Acumulado {
  return { km: 0, viagens: 0, litros: 0, combustivelCents: 0, multasCents: 0, multasQtd: 0, horasMin: 0, maoDeObraCents: 0, semValorHora: false, escalaDias: 0 };
}

function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Mes da URL validado; sem mes (ou invalido), o mes corrente no calendario
// de Brasilia — o relogio do servidor (UTC) virava o mes as 21h do ultimo dia.
export function parseMes(mes: string | undefined): Date {
  return mesParam(mes);
}

// Custo operacional do mes por veiculo e por cliente/contrato, juntando o
// que cada modulo ja tem separado: combustivel (FuelTransaction), multas
// (Multa), km real (VehicleTrip da Ituran) e mao de obra.
//
// Mao de obra (2026-09-13, decisao do usuario): a base e o ESPELHO DE PONTO
// apurado pelo TiqueTaque (TimesheetMensal) x valor-hora nua do motorista:
//   base     = (horas normais + DSR + folga) x hora   — as horas PAGAS do mes
//   HE 50%   = extra_50 x hora x (1 + % da CCT/ACT, minimo 50%)
//   HE 100%  = extra_100 x hora x 2
//   noturno  = adicional_noturno x hora x (% da CCT/ACT, minimo 20%)
//              + hora_noturna_reduzida x hora
//   encargos = subtotal x Company.encargosPercentual
// O TiqueTaque ja classifica feriado/DSR trabalhado conforme as regras
// configuradas la — nao reimplementamos. Motorista sem espelho no mes cai
// no calculo antigo (minutos do ponto x hora), sinalizado na tela; sem
// valor-hora nao entra em R$ (so em horas). O custo mensal do motorista e
// rateado entre as escalas dele no mes proporcional aos minutos de ponto
// atribuidos a cada escala (motorista com custo mas sem escala vai pra
// "Sem escala no SIAT").
//
// Atribuicao a cliente: Escala.clientName do SIAT. Km e exato (VehicleTrip
// aponta pra Escala). Combustivel e multa sao do VEICULO — rateados entre
// os clientes atendidos no mes proporcional aos dias de escala.
export async function buildCustosMes(companyId: string, monthStart: Date): Promise<CustosMes> {
  const monthEnd = addMonths(monthStart, 1);
  const mesISO = format(monthStart, "yyyy-MM");
  const startUtc = brazilDateStringToUtc(format(monthStart, "yyyy-MM-dd"));
  const endUtc = brazilDateStringToUtc(format(monthEnd, "yyyy-MM-dd"));

  const [company, vehicles, drivers, timesheets, fuel, multas, trips, escalas, entries, osMes] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { encargosPercentual: true } }),
    prisma.vehicle.findMany({ where: { companyId }, select: { id: true, plate: true, brand: true, model: true } }),
    prisma.driver.findMany({
      where: { companyId },
      select: {
        id: true,
        valorHoraCents: true,
        regimeHoras: true,
        sindicato: {
          select: {
            nome: true,
            convencoes: {
              select: { tipo: true, vigenciaInicio: true, vigenciaFim: true, regras: { select: { tipo: true, valorNumerico: true, descricao: true } } },
            },
          },
        },
      },
    }),
    prisma.timesheetMensal.findMany({ where: { companyId, mes: mesISO } }),
    prisma.fuelTransaction.findMany({
      where: { companyId, dataHora: { gte: startUtc, lt: endUtc } },
      select: { vehicleId: true, placaOriginal: true, valorCents: true, volumeLitros: true },
    }),
    prisma.multa.findMany({
      where: { companyId, dataInfracao: { gte: monthStart, lt: monthEnd } },
      select: { vehicleId: true, placaConsultada: true, valorCents: true },
    }),
    prisma.vehicleTrip.findMany({
      where: { companyId, startAt: { gte: startUtc, lt: endUtc } },
      select: { vehicleId: true, distanceKm: true, escalaId: true },
    }),
    prisma.escala.findMany({
      where: { companyId, date: { gte: monthStart, lt: monthEnd } },
      select: { id: true, vehicleId: true, driverId: true, date: true, clientName: true },
    }),
    prisma.timeClockEntry.findMany({
      where: { companyId, date: { gte: monthStart, lt: monthEnd } },
      select: { driverId: true, date: true, clockIn: true, clockOut: true, intervaloInicio: true, intervaloFim: true, punches: true },
    }),
    prisma.ordemServico.findMany({
      where: { companyId, status: "finished", fimEm: { gte: startUtc, lt: endUtc } },
      select: { custoCents: true },
    }),
  ]);

  const encargosPercentual = company?.encargosPercentual ?? null;
  const fatorEncargos = 1 + (encargosPercentual ?? 0) / 100;
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const timesheetByDriver = new Map(timesheets.map((t) => [t.driverId, t]));

  const vehicleIdByPlate = new Map<string, string>();
  for (const v of vehicles) for (const p of platePhysicalVariants(v.plate)) vehicleIdByPlate.set(p, v.id);
  const resolveVehicle = (vehicleId: string | null, placa: string) => vehicleId ?? vehicleIdByPlate.get(normalizePlate(placa)) ?? null;

  const porVeiculo = new Map<string, Acumulado & { viagensSemEscala: number; clientes: Set<string> }>();
  const porCliente = new Map<string, Acumulado & { veiculos: Set<string>; motoristas: Set<string> }>();
  const veiculo = (id: string) => {
    let acc = porVeiculo.get(id);
    if (!acc) porVeiculo.set(id, (acc = { ...novoAcumulado(), viagensSemEscala: 0, clientes: new Set() }));
    return acc;
  };
  const cliente = (nome: string) => {
    let acc = porCliente.get(nome);
    if (!acc) porCliente.set(nome, (acc = { ...novoAcumulado(), veiculos: new Set(), motoristas: new Set() }));
    return acc;
  };

  // --- Escalas: dias por veiculo x cliente (base do rateio) e minutos de ponto por escala ---
  const escalaById = new Map(escalas.map((e) => [e.id, e]));
  const escalasPorDriverDia = new Map<string, number>();
  for (const e of escalas) {
    const k = `${e.driverId}_${format(e.date, "yyyy-MM-dd")}`;
    escalasPorDriverDia.set(k, (escalasPorDriverDia.get(k) ?? 0) + 1);
  }
  const workedByDriverDia = new Map<string, number>();
  for (const en of entries) {
    const w = workedMinutes(en);
    if (w != null && w > 0) workedByDriverDia.set(`${en.driverId}_${format(en.date, "yyyy-MM-dd")}`, w);
  }
  type EscalaMin = { vehicleId: string | null; nomeCliente: string; minutos: number };
  const escalasPorDriver = new Map<string, EscalaMin[]>();
  const unidadesPorVeiculoCliente = new Map<string, Map<string, number>>();
  const unidadesVistas = new Set<string>();
  for (const e of escalas) {
    const nomeCliente = e.clientName?.trim() || SEM_CLIENTE;
    const diaKey = `${e.driverId}_${format(e.date, "yyyy-MM-dd")}`;
    const n = escalasPorDriverDia.get(diaKey) ?? 1;
    const minutos = (workedByDriverDia.get(diaKey) ?? 0) / n;
    const lista = escalasPorDriver.get(e.driverId) ?? [];
    lista.push({ vehicleId: e.vehicleId, nomeCliente, minutos });
    escalasPorDriver.set(e.driverId, lista);

    const c = cliente(nomeCliente);
    c.horasMin += minutos;
    c.motoristas.add(e.driverId);
    c.escalaDias += 1;
    if (e.vehicleId) {
      const v = veiculo(e.vehicleId);
      v.horasMin += minutos;
      v.clientes.add(nomeCliente);
      v.escalaDias += 1;
      c.veiculos.add(e.vehicleId);
      const unidadeKey = `${e.vehicleId}_${format(e.date, "yyyy-MM-dd")}_${nomeCliente}`;
      if (!unidadesVistas.has(unidadeKey)) {
        unidadesVistas.add(unidadeKey);
        let m = unidadesPorVeiculoCliente.get(e.vehicleId);
        if (!m) unidadesPorVeiculoCliente.set(e.vehicleId, (m = new Map()));
        m.set(nomeCliente, (m.get(nomeCliente) ?? 0) + 1);
      }
    }
  }

  // --- Mao de obra por motorista (espelho x hora x encargos), rateada pelas escalas ---
  const mao: MaoDeObraResumo = {
    encargosPercentual,
    baseCents: 0,
    he50Cents: 0,
    he100Cents: 0,
    noturnoCents: 0,
    encargosCents: 0,
    totalCents: 0,
    horasNormais: 0,
    horasExtra50: 0,
    horasExtra100: 0,
    motoristasComEspelho: 0,
    motoristasSemEspelho: 0,
    motoristasSemValorHora: 0,
  };
  const motoristasRelevantes = new Set<string>([...escalasPorDriver.keys(), ...timesheetByDriver.keys()]);
  for (const driverId of motoristasRelevantes) {
    const d = driverById.get(driverId);
    const ts = timesheetByDriver.get(driverId);
    const lista = escalasPorDriver.get(driverId) ?? [];
    const minutosTotal = lista.reduce((s, e) => s + e.minutos, 0);
    if (!d || !d.valorHoraCents) {
      if (minutosTotal > 0 || ts) {
        mao.motoristasSemValorHora += 1;
        for (const e of lista) {
          cliente(e.nomeCliente).semValorHora = true;
          if (e.vehicleId) veiculo(e.vehicleId).semValorHora = true;
        }
      }
      continue;
    }
    const hora = d.valorHoraCents;
    let subtotal: number;
    if (ts) {
      const pct50 = Math.max(resolveRegra(d, "HORA_EXTRA", monthStart).valorNumerico ?? HORA_EXTRA_PERCENTUAL_MINIMO, HORA_EXTRA_PERCENTUAL_MINIMO);
      const pctNot = resolveRegra(d, "ADICIONAL_NOTURNO", monthStart).valorNumerico ?? ADICIONAL_NOTURNO_PERCENTUAL_MINIMO;
      const base = Math.round((ts.horasNormais + ts.dsr + ts.folga) * hora);
      const he50 = Math.round(ts.extra50 * hora * (1 + pct50 / 100));
      const he100 = Math.round(ts.extra100 * hora * 2);
      const noturno = Math.round(ts.adicionalNoturno * hora * (pctNot / 100) + ts.horaNoturnaReduzida * hora);
      subtotal = base + he50 + he100 + noturno;
      mao.baseCents += base;
      mao.he50Cents += he50;
      mao.he100Cents += he100;
      mao.noturnoCents += noturno;
      mao.horasNormais += ts.horasNormais;
      mao.horasExtra50 += ts.extra50;
      mao.horasExtra100 += ts.extra100;
      mao.motoristasComEspelho += 1;
    } else {
      if (minutosTotal === 0) continue;
      subtotal = Math.round((minutosTotal / 60) * hora);
      mao.baseCents += subtotal;
      mao.motoristasSemEspelho += 1;
    }
    const encargos = Math.round(subtotal * (fatorEncargos - 1));
    const total = subtotal + encargos;
    mao.encargosCents += encargos;
    mao.totalCents += total;

    if (minutosTotal === 0) {
      cliente(SEM_ESCALA).maoDeObraCents += total;
      cliente(SEM_ESCALA).motoristas.add(driverId);
      continue;
    }
    for (const e of lista) {
      const parte = Math.round(total * (e.minutos / minutosTotal));
      cliente(e.nomeCliente).maoDeObraCents += parte;
      if (e.vehicleId) veiculo(e.vehicleId).maoDeObraCents += parte;
    }
  }

  // --- Km (Ituran): exato por escala ---
  let viagensSemEscala = 0;
  for (const t of trips) {
    const km = t.distanceKm ?? 0;
    const v = veiculo(t.vehicleId);
    v.km += km;
    v.viagens += 1;
    const escala = t.escalaId ? escalaById.get(t.escalaId) : undefined;
    const nomeCliente = escala ? escala.clientName?.trim() || SEM_CLIENTE : SEM_ESCALA;
    if (!escala) {
      v.viagensSemEscala += 1;
      viagensSemEscala += 1;
    }
    const c = cliente(nomeCliente);
    c.km += km;
    c.viagens += 1;
    c.veiculos.add(t.vehicleId);
  }

  // --- Combustivel e multas: por veiculo, depois rateio por cliente ---
  let combustivelSemVeiculoCents = 0;
  let multasSemVeiculoCents = 0;
  const ratear = (vehicleId: string, cents: number, litros: number, multaQtd: number) => {
    const unidades = unidadesPorVeiculoCliente.get(vehicleId);
    const total = unidades ? [...unidades.values()].reduce((s, n) => s + n, 0) : 0;
    if (!unidades || total === 0) {
      const c = cliente(SEM_ESCALA);
      c.combustivelCents += litros > 0 ? cents : 0;
      c.litros += litros;
      c.multasCents += multaQtd > 0 ? cents : 0;
      c.multasQtd += multaQtd;
      c.veiculos.add(vehicleId);
      return;
    }
    for (const [nome, n] of unidades) {
      const frac = n / total;
      const c = cliente(nome);
      if (litros > 0) {
        c.combustivelCents += Math.round(cents * frac);
        c.litros += litros * frac;
      } else {
        c.multasCents += Math.round(cents * frac);
        c.multasQtd += multaQtd * frac;
      }
    }
  };
  for (const f of fuel) {
    const vehicleId = resolveVehicle(f.vehicleId, f.placaOriginal);
    if (!vehicleId) {
      combustivelSemVeiculoCents += f.valorCents;
      continue;
    }
    const v = veiculo(vehicleId);
    v.combustivelCents += f.valorCents;
    v.litros += f.volumeLitros;
    ratear(vehicleId, f.valorCents, f.volumeLitros, 0);
  }
  for (const m of multas) {
    const vehicleId = resolveVehicle(m.vehicleId, m.placaConsultada);
    const cents = m.valorCents ?? 0;
    if (!vehicleId) {
      multasSemVeiculoCents += cents;
      continue;
    }
    const v = veiculo(vehicleId);
    v.multasCents += cents;
    v.multasQtd += 1;
    ratear(vehicleId, cents, 0, 1);
  }

  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const veiculosOut: CustoVeiculo[] = [...porVeiculo.entries()]
    .map(([vehicleId, a]) => {
      const v = vehicleById.get(vehicleId);
      const totalCents = a.combustivelCents + a.multasCents + a.maoDeObraCents;
      const km = Math.round(a.km);
      return {
        ...a,
        km,
        vehicleId,
        plate: v?.plate ?? "?",
        modelo: v ? `${v.brand} ${v.model}`.trim() : "",
        clientes: [...a.clientes].sort(),
        totalCents,
        custoPorKmCents: km > 0 ? totalCents / km : null,
        combustivelPorKmCents: km > 0 && a.combustivelCents > 0 ? a.combustivelCents / km : null,
        kmPorLitro: km > 0 && a.litros > 0 ? km / a.litros : null,
      };
    })
    .sort((x, y) => y.totalCents - x.totalCents);

  const clientesOut: CustoCliente[] = [...porCliente.entries()]
    .map(([nome, a]) => {
      const totalCents = a.combustivelCents + a.multasCents + a.maoDeObraCents;
      const km = Math.round(a.km);
      return {
        ...a,
        km,
        multasQtd: Math.round(a.multasQtd * 10) / 10,
        nome,
        veiculos: a.veiculos.size,
        motoristas: a.motoristas.size,
        totalCents,
        custoPorKmCents: km > 0 ? totalCents / km : null,
        custoPorHoraCents: a.horasMin > 0 ? totalCents / (a.horasMin / 60) : null,
      };
    })
    .sort((x, y) => y.totalCents - x.totalCents);

  // Totais por cliente (nao por veiculo): mao de obra de quem nao tem escala
  // com veiculo so existe no lado do cliente ("Sem escala"), entao somar por
  // veiculo perderia essa parcela.
  const somaC = (f: (c: CustoCliente) => number) => clientesOut.reduce((s, c) => s + f(c), 0);
  const combustivelCents = somaC((c) => c.combustivelCents);
  const multasCents = somaC((c) => c.multasCents);
  const maoDeObraCents = somaC((c) => c.maoDeObraCents);

  return {
    monthStart,
    veiculos: veiculosOut,
    clientes: clientesOut,
    maoDeObra: mao,
    manutencao: {
      osConcluidas: osMes.length,
      osComCusto: osMes.filter((o) => (o.custoCents ?? 0) > 0).length,
      custoLancadoCents: osMes.reduce((s, o) => s + (o.custoCents ?? 0), 0),
    },
    totais: {
      combustivelCents,
      litros: somaC((c) => c.litros),
      multasCents,
      multasQtd: Math.round(somaC((c) => c.multasQtd)),
      km: somaC((c) => c.km),
      viagens: somaC((c) => c.viagens),
      viagensSemEscala,
      horasMin: somaC((c) => c.horasMin),
      maoDeObraCents,
      combustivelSemVeiculoCents,
      multasSemVeiculoCents,
      totalCents: combustivelCents + multasCents + maoDeObraCents,
    },
  };
}
