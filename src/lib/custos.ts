import { addMonths, format, startOfMonth } from "date-fns";
import { prisma } from "@/lib/prisma";
import { brazilDateStringToUtc } from "@/lib/date";
import { platePhysicalVariants } from "@/lib/plate";
import { workedMinutes } from "@/lib/pontoCompliance";

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

export type CustosMes = {
  monthStart: Date;
  veiculos: CustoVeiculo[];
  clientes: CustoCliente[];
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
    motoristasSemValorHora: number;
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

export function parseMes(mes: string | undefined): Date {
  const anchor = mes && /^\d{4}-\d{2}$/.test(mes) ? new Date(`${mes}-01T00:00:00`) : new Date();
  return startOfMonth(Number.isNaN(anchor.getTime()) ? new Date() : anchor);
}

// Custo operacional do mes por veiculo e por cliente/contrato, juntando o
// que cada modulo ja tem separado: combustivel (FuelTransaction), multas
// (Multa), km real (VehicleTrip da Ituran) e horas de motorista (ponto).
//
// Atribuicao a cliente: a chave e Escala.clientName do SIAT (a fonte oficial
// de despacho). Km sai exato — cada VehicleTrip ja aponta pra sua Escala.
// Horas do motorista: o ponto do dia vai pra(s) escala(s) dele naquele dia,
// dividido igualmente se houver mais de uma. Combustivel e multa sao do
// VEICULO, nao da viagem — entao sao rateados entre os clientes que o
// veiculo atendeu no mes, proporcional aos dias de escala de cada um. E uma
// aproximacao explicita (aparece na tela), nao um custeio contabil.
export async function buildCustosMes(companyId: string, monthStart: Date): Promise<CustosMes> {
  const monthEnd = addMonths(monthStart, 1);
  const startUtc = brazilDateStringToUtc(format(monthStart, "yyyy-MM-dd"));
  const endUtc = brazilDateStringToUtc(format(monthEnd, "yyyy-MM-dd"));

  const [vehicles, drivers, fuel, multas, trips, escalas, entries] = await Promise.all([
    prisma.vehicle.findMany({ where: { companyId }, select: { id: true, plate: true, brand: true, model: true } }),
    prisma.driver.findMany({ where: { companyId }, select: { id: true, valorHoraCents: true } }),
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
  ]);

  const vehicleIdByPlate = new Map<string, string>();
  for (const v of vehicles) for (const p of platePhysicalVariants(v.plate)) vehicleIdByPlate.set(p, v.id);
  const resolveVehicle = (vehicleId: string | null, placa: string) => vehicleId ?? vehicleIdByPlate.get(normalizePlate(placa)) ?? null;
  const valorHoraByDriver = new Map(drivers.map((d) => [d.id, d.valorHoraCents]));

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

  // --- Escalas: dias por veiculo x cliente (base do rateio) e horas de motorista ---
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
  // unidades de rateio: 1 por (veiculo, dia, cliente)
  const unidadesPorVeiculoCliente = new Map<string, Map<string, number>>();
  const unidadesVistas = new Set<string>();
  for (const e of escalas) {
    const nomeCliente = e.clientName?.trim() || SEM_CLIENTE;
    const diaKey = `${e.driverId}_${format(e.date, "yyyy-MM-dd")}`;
    const n = escalasPorDriverDia.get(diaKey) ?? 1;
    const minutos = (workedByDriverDia.get(diaKey) ?? 0) / n;
    const valorHora = valorHoraByDriver.get(e.driverId) ?? null;
    const custo = valorHora ? Math.round((minutos / 60) * valorHora) : 0;

    const c = cliente(nomeCliente);
    c.horasMin += minutos;
    c.maoDeObraCents += custo;
    if (minutos > 0 && !valorHora) c.semValorHora = true;
    c.motoristas.add(e.driverId);
    c.escalaDias += 1;

    if (e.vehicleId) {
      const v = veiculo(e.vehicleId);
      v.horasMin += minutos;
      v.maoDeObraCents += custo;
      if (minutos > 0 && !valorHora) v.semValorHora = true;
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

  const soma = (f: (v: CustoVeiculo) => number) => veiculosOut.reduce((s, v) => s + f(v), 0);
  const motoristasComPonto = new Set([...workedByDriverDia.keys()].map((k) => k.split("_")[0]));
  const motoristasSemValorHora = [...motoristasComPonto].filter((id) => !valorHoraByDriver.get(id)).length;
  const combustivelCents = soma((v) => v.combustivelCents);
  const multasCents = soma((v) => v.multasCents);
  const maoDeObraCents = soma((v) => v.maoDeObraCents);

  return {
    monthStart,
    veiculos: veiculosOut,
    clientes: clientesOut,
    totais: {
      combustivelCents,
      litros: soma((v) => v.litros),
      multasCents,
      multasQtd: soma((v) => v.multasQtd),
      km: soma((v) => v.km),
      viagens: soma((v) => v.viagens),
      viagensSemEscala,
      horasMin: soma((v) => v.horasMin),
      maoDeObraCents,
      motoristasSemValorHora,
      combustivelSemVeiculoCents,
      multasSemVeiculoCents,
      totalCents: combustivelCents + multasCents + maoDeObraCents,
    },
  };
}
