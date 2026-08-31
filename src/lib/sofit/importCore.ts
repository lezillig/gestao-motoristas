// Nucleo da sincronizacao Sofit -> nosso banco, SEM checagem de sessao:
// quem chama (Server Action autenticada por role, rota de cron autenticada
// por secret, ou webhook autenticado por secret) e responsavel por verificar
// permissao antes. Mesma divisao ja usada na integracao do TiqueTaque (ver
// src/lib/tiquetaque/importCore.ts) — e o que permite reusar a mesma logica
// da tela e do agendamento sem duplicar codigo.
//
// Principios que valem pra TODAS as entidades aqui:
//
// 1. Melhor esforco: item invalido vira mensagem de erro reportada, nunca
//    aborta o lote inteiro (mesmo criterio das importacoes de planilha).
// 2. Nunca apagar dado nosso com vazio deles: campo ausente no Sofit deixa o
//    valor local como esta (um veiculo com marca preenchida a mao nao perde
//    a marca porque o Sofit nao mandou o campo).
// 3. Hodometro so anda pra frente: `currentMileage` nunca e reduzido por
//    uma leitura menor que a atual, do mesmo jeito que o fechamento de
//    VehicleUsageLog so escreve km final maior.
// 4. Idempotencia: rodar a mesma sincronizacao duas vezes nao duplica nada
//    (abastecimento dedupa por codigo do Sofit; cadastro e upsert).

import { prisma } from "@/lib/prisma";
import {
  fetchSofitFuelSupplies,
  fetchSofitMaintenances,
  fetchSofitOdometerReadings,
  fetchSofitVehicles,
  type SofitPeriod,
} from "./client";
import type {
  SofitEntity,
  SofitFuelSupply,
  SofitMaintenance,
  SofitOdometerReading,
  SofitSyncEntityResult,
  SofitVehicle,
} from "./types";

// Teto de mensagens guardadas por execucao no SofitSyncLog. Um lote com
// milhares de itens invalidos (tipico de caminho/mapeamento errado logo na
// implantacao) nao pode virar uma linha de log gigante no banco.
const MAX_MENSAGENS_LOG = 50;

// Codigo de deduplicacao gravado em FuelTransaction.codigoTransacao (coluna
// UNIQUE ja existente, usada tambem pelo extrato do cartao). O prefixo
// "SOFIT:" evita colisao com um codigo de transacao do cartao que por acaso
// seja igual a um id do Sofit; a empresa entra na chave porque a coluna e
// UNIQUE GLOBAL, e ids curtos do Sofit ("77") se repetiriam entre contas de
// empresas diferentes — sem isso, a segunda empresa a sincronizar teria o
// abastecimento descartado em silencio como se fosse duplicata.
const SOFIT_TX_PREFIX = "SOFIT:";

function codigoTransacaoSofit(companyId: string, externalId: string): string {
  return `${SOFIT_TX_PREFIX}${companyId}:${externalId}`;
}

const VALOR_NAO_INFORMADO = "Não informado";

function emptyResult(entidade: SofitEntity): SofitSyncEntityResult {
  return { entidade, lidos: 0, criados: 0, atualizados: 0, ignorados: 0, avisos: [], erros: [] };
}

// ---------- Veiculos ----------

export async function syncVehiclesIntoDb(
  companyId: string,
  vehicles: SofitVehicle[]
): Promise<SofitSyncEntityResult> {
  const result = emptyResult("VEICULOS");
  result.lidos = vehicles.length;
  if (vehicles.length === 0) return result;

  const plates = vehicles.map((v) => v.plate);
  // Vehicle.plate e UNIQUE global (nao por empresa), entao a busca precisa
  // ser por placa sem filtro de empresa: uma placa que existe em OUTRA
  // empresa nao pode ser criada aqui (violaria a constraint) nem atualizada
  // (seria vazamento entre tenants) — vira item ignorado com aviso claro.
  const existing = await prisma.vehicle.findMany({
    where: { plate: { in: plates } },
    select: { id: true, plate: true, companyId: true, brand: true, model: true, year: true, type: true, currentMileage: true, status: true },
  });
  const existingByPlate = new Map(existing.map((v) => [v.plate, v]));

  for (const vehicle of vehicles) {
    const current = existingByPlate.get(vehicle.plate);

    if (current && current.companyId !== companyId) {
      result.ignorados++;
      result.erros.push(`Placa ${vehicle.plate} já está cadastrada em outra empresa — não sincronizada.`);
      continue;
    }

    if (!current) {
      const faltando: string[] = [];
      if (!vehicle.brand) faltando.push("marca");
      if (!vehicle.model) faltando.push("modelo");
      if (!vehicle.type) faltando.push("tipo");
      if (vehicle.year === null) faltando.push("ano");
      if (faltando.length > 0) {
        // Criado assim mesmo: um veiculo real da frota faltando na nossa
        // base atrapalha mais (abastecimento fica "sem vínculo", escala nao
        // pode ser criada) do que um cadastro incompleto que o gestor
        // completa depois. O aviso diz exatamente o que completar.
        result.avisos.push(`Veículo ${vehicle.plate} criado sem ${faltando.join("/")} — complete no cadastro.`);
      }
      await prisma.vehicle.create({
        data: {
          companyId,
          plate: vehicle.plate,
          brand: vehicle.brand ?? VALOR_NAO_INFORMADO,
          model: vehicle.model ?? VALOR_NAO_INFORMADO,
          // Ano 0 = desconhecido. O formulario de cadastro exige 1980-2100,
          // entao o gestor e obrigado a corrigir na primeira edicao — e um
          // 0 visivel na lista e melhor que um ano inventado.
          year: vehicle.year ?? 0,
          type: vehicle.type ?? VALOR_NAO_INFORMADO,
          status: vehicle.status ?? "ATIVO",
          currentMileage: vehicle.odometer ?? 0,
        },
      });
      result.criados++;
      continue;
    }

    // Update parcial: so entra no `data` o campo que o Sofit realmente
    // mandou E que mudou. Ou seja, o Sofit VENCE quando manda um valor (ele
    // e o sistema de gestao da frota — se marca/modelo/situacao divergem, o
    // certo e o lado dele), e o valor local so e preservado quando o campo
    // nao veio (principio 2). A excecao e o hodometro, que nunca retrocede
    // (principio 3), porque ali "mais recente" e sempre "maior".
    const data: {
      brand?: string;
      model?: string;
      year?: number;
      type?: string;
      status?: "ATIVO" | "MANUTENCAO" | "INATIVO";
      currentMileage?: number;
    } = {};
    if (vehicle.brand && vehicle.brand !== current.brand) data.brand = vehicle.brand;
    if (vehicle.model && vehicle.model !== current.model) data.model = vehicle.model;
    if (vehicle.year !== null && vehicle.year !== current.year) data.year = vehicle.year;
    if (vehicle.type && vehicle.type !== current.type) data.type = vehicle.type;
    if (vehicle.status && vehicle.status !== current.status) data.status = vehicle.status;
    if (vehicle.odometer !== null && vehicle.odometer > current.currentMileage) {
      data.currentMileage = vehicle.odometer;
    }

    if (Object.keys(data).length === 0) {
      result.ignorados++;
      continue;
    }
    await prisma.vehicle.update({ where: { id: current.id }, data });
    result.atualizados++;
  }

  return result;
}

// ---------- Abastecimentos ----------

export async function syncFuelSuppliesIntoDb(
  companyId: string,
  supplies: SofitFuelSupply[]
): Promise<SofitSyncEntityResult> {
  const result = emptyResult("ABASTECIMENTOS");
  result.lidos = supplies.length;
  if (supplies.length === 0) return result;

  // Heuristica de duplicata por data/valor so e necessaria pros
  // abastecimentos que vierem SEM id no Sofit (com id, a coluna UNIQUE ja
  // resolve). Quando todo o lote tem id — o caso normal —, a consulta da
  // janela nem acontece.
  const algumSemId = supplies.some((s) => !s.externalId);
  const janela = supplies.reduce(
    (acc, s) => ({
      min: Math.min(acc.min, s.dataHora.getTime()),
      max: Math.max(acc.max, s.dataHora.getTime()),
    }),
    { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
  );

  const [vehicles, drivers, existingCodigos, existingTxs] = await Promise.all([
    prisma.vehicle.findMany({ where: { companyId }, select: { id: true, plate: true } }),
    prisma.driver.findMany({ where: { companyId }, select: { id: true, cpf: true, name: true } }),
    prisma.fuelTransaction.findMany({
      where: { companyId, codigoTransacao: { startsWith: SOFIT_TX_PREFIX } },
      select: { codigoTransacao: true },
    }),
    algumSemId
      ? prisma.fuelTransaction.findMany({
          // Janela do lote com folga de 1 dia nas pontas — mesma heuristica
          // (tolerancia de 1 minuto e 2 centavos) ja usada na importacao do
          // template manual de combustivel.
          where: {
            companyId,
            dataHora: { gte: new Date(janela.min - 86_400_000), lte: new Date(janela.max + 86_400_000) },
          },
          select: { vehicleId: true, dataHora: true, valorCents: true },
        })
      : Promise.resolve([] as { vehicleId: string | null; dataHora: Date; valorCents: number }[]),
  ]);

  const vehicleByPlate = new Map(vehicles.map((v) => [v.plate, v.id]));
  // Driver.cpf nem sempre tem so digitos no cadastro manual — normaliza os
  // dois lados (mesmo cuidado de combustivel/actions.ts).
  const driverByCpf = new Map(drivers.map((d) => [d.cpf.replace(/\D/g, ""), d.id]));
  const driverByName = new Map(drivers.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const codigosVistos = new Set(existingCodigos.map((t) => t.codigoTransacao as string));

  const DUPLICATE_TOLERANCE_CENTS = 2;
  const isHeuristicDuplicate = (vehicleId: string | null, dataHora: Date, valorCents: number) =>
    existingTxs.some(
      (t) =>
        t.vehicleId === vehicleId &&
        Math.abs(t.dataHora.getTime() - dataHora.getTime()) < 60_000 &&
        Math.abs(t.valorCents - valorCents) <= DUPLICATE_TOLERANCE_CENTS
    );

  const toCreate: {
    companyId: string;
    vehicleId: string | null;
    driverId: string | null;
    dataHora: Date;
    valorCents: number;
    volumeLitros: number;
    combustivel: string | null;
    posto: string | null;
    cidade: string | null;
    uf: string | null;
    hodometro: number | null;
    codigoTransacao: string | null;
    placaOriginal: string;
    motoristaOriginal: string | null;
  }[] = [];

  for (const supply of supplies) {
    const codigoTransacao = supply.externalId ? codigoTransacaoSofit(companyId, supply.externalId) : null;
    if (codigoTransacao && codigosVistos.has(codigoTransacao)) {
      result.ignorados++;
      continue;
    }

    // Placa sem veiculo cadastrado NAO rejeita a transacao (mesma decisao da
    // importacao do extrato do cartao: visibilidade financeira vale mais que
    // o vinculo) — entra com vehicleId nulo e aparece como "sem vínculo".
    const vehicleId = vehicleByPlate.get(supply.plate) ?? null;
    const driverId =
      (supply.motoristaCpf && supply.motoristaCpf.length === 11 ? driverByCpf.get(supply.motoristaCpf) : undefined) ??
      (supply.motoristaNome ? driverByName.get(supply.motoristaNome.trim().toLowerCase()) : undefined) ??
      null;

    if (!codigoTransacao && isHeuristicDuplicate(vehicleId, supply.dataHora, supply.valorCents)) {
      result.ignorados++;
      continue;
    }

    if (codigoTransacao) codigosVistos.add(codigoTransacao); // dedup dentro do proprio lote
    toCreate.push({
      companyId,
      vehicleId,
      driverId,
      dataHora: supply.dataHora,
      valorCents: supply.valorCents,
      volumeLitros: supply.volumeLitros,
      combustivel: supply.combustivel,
      posto: supply.posto,
      cidade: supply.cidade,
      uf: supply.uf,
      hodometro: supply.hodometro,
      codigoTransacao,
      placaOriginal: supply.plate,
      motoristaOriginal: supply.motoristaNome,
    });
  }

  if (toCreate.length > 0) {
    // skipDuplicates cobre a corrida entre duas execucoes simultaneas (cron
    // e sincronizacao manual ao mesmo tempo) baterem no mesmo
    // codigoTransacao UNIQUE.
    const created = await prisma.fuelTransaction.createMany({ data: toCreate, skipDuplicates: true });
    result.criados = created.count;
    result.ignorados += toCreate.length - created.count;
  }

  // Hodometro do abastecimento tambem faz o km do veiculo andar — e a
  // leitura mais frequente que existe na frota (toda vez que abastece).
  const maiorHodometroPorPlaca = new Map<string, number>();
  for (const supply of supplies) {
    if (supply.hodometro === null || supply.hodometro <= 0) continue;
    const atual = maiorHodometroPorPlaca.get(supply.plate);
    if (atual === undefined || supply.hodometro > atual) maiorHodometroPorPlaca.set(supply.plate, supply.hodometro);
  }
  await avancarHodometros(companyId, maiorHodometroPorPlaca);

  return result;
}

// ---------- Manutencoes ----------

export async function syncMaintenancesIntoDb(
  companyId: string,
  maintenances: SofitMaintenance[]
): Promise<SofitSyncEntityResult> {
  const result = emptyResult("MANUTENCOES");
  result.lidos = maintenances.length;
  if (maintenances.length === 0) return result;

  // Nao existe (ainda) um modulo de manutencao no sistema — o que temos e um
  // contador preventivo por veiculo (Vehicle.lastMaintenanceMileage, ver
  // src/lib/maintenance.ts). Entao a sincronizacao aqui e deliberadamente
  // enxuta: a manutencao CONCLUIDA de maior hodometro por placa reseta esse
  // contador, exatamente como o botao "registrar manutenção" faz na tela de
  // utilizacao. Manutencao em aberto nao reseta nada (o veiculo ainda esta
  // na oficina).
  const maiorKmPorPlaca = new Map<string, number>();
  for (const item of maintenances) {
    if (!item.concluida) {
      result.ignorados++;
      continue;
    }
    if (item.hodometro === null || item.hodometro <= 0) {
      result.ignorados++;
      result.avisos.push(`Manutenção da placa ${item.plate} sem hodômetro — não atualizou o contador preventivo.`);
      continue;
    }
    const atual = maiorKmPorPlaca.get(item.plate);
    if (atual === undefined || item.hodometro > atual) maiorKmPorPlaca.set(item.plate, item.hodometro);
  }

  if (maiorKmPorPlaca.size === 0) return result;

  const vehicles = await prisma.vehicle.findMany({
    where: { companyId, plate: { in: [...maiorKmPorPlaca.keys()] } },
    select: { id: true, plate: true, currentMileage: true, lastMaintenanceMileage: true },
  });
  const encontradas = new Set(vehicles.map((v) => v.plate));
  for (const plate of maiorKmPorPlaca.keys()) {
    if (!encontradas.has(plate)) {
      result.ignorados++;
      result.avisos.push(`Manutenção da placa ${plate}: veículo não cadastrado — sincronize os veículos primeiro.`);
    }
  }

  for (const vehicle of vehicles) {
    const km = maiorKmPorPlaca.get(vehicle.plate)!;
    if (km <= vehicle.lastMaintenanceMileage) {
      result.ignorados++; // manutencao ja conhecida (ou mais antiga que a ultima)
      continue;
    }
    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        lastMaintenanceMileage: km,
        // A manutencao aconteceu com o veiculo nesse km, entao o hodometro
        // atual e no minimo esse valor (principio 3: so pra frente).
        ...(km > vehicle.currentMileage ? { currentMileage: km } : {}),
      },
    });
    result.atualizados++;
  }

  return result;
}

// ---------- Odometro ----------

export async function syncOdometerIntoDb(
  companyId: string,
  readings: SofitOdometerReading[]
): Promise<SofitSyncEntityResult> {
  const result = emptyResult("ODOMETRO");
  result.lidos = readings.length;
  if (readings.length === 0) return result;

  const maiorPorPlaca = new Map<string, number>();
  for (const reading of readings) {
    const atual = maiorPorPlaca.get(reading.plate);
    if (atual === undefined || reading.hodometro > atual) maiorPorPlaca.set(reading.plate, reading.hodometro);
  }

  const { atualizados, semCadastro, semAvanco } = await avancarHodometros(companyId, maiorPorPlaca);
  result.atualizados = atualizados;
  result.ignorados = semAvanco + semCadastro.length;
  for (const plate of semCadastro) {
    result.avisos.push(`Odômetro da placa ${plate}: veículo não cadastrado — sincronize os veículos primeiro.`);
  }
  return result;
}

// Avanca Vehicle.currentMileage pra `km` quando (e so quando) for maior que
// o atual. Compartilhado por odometro, abastecimento e manutencao.
async function avancarHodometros(
  companyId: string,
  kmPorPlaca: Map<string, number>
): Promise<{ atualizados: number; semAvanco: number; semCadastro: string[] }> {
  if (kmPorPlaca.size === 0) return { atualizados: 0, semAvanco: 0, semCadastro: [] };

  const vehicles = await prisma.vehicle.findMany({
    where: { companyId, plate: { in: [...kmPorPlaca.keys()] } },
    select: { id: true, plate: true, currentMileage: true },
  });
  const encontradas = new Set(vehicles.map((v) => v.plate));
  const semCadastro = [...kmPorPlaca.keys()].filter((plate) => !encontradas.has(plate));

  let atualizados = 0;
  let semAvanco = 0;
  for (const vehicle of vehicles) {
    const km = kmPorPlaca.get(vehicle.plate)!;
    if (km <= vehicle.currentMileage) {
      semAvanco++;
      continue;
    }
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { currentMileage: km } });
    atualizados++;
  }
  return { atualizados, semAvanco, semCadastro };
}

// ---------- Orquestracao ----------

export type SofitSyncOrigem = "MANUAL" | "CRON" | "WEBHOOK";

export type RunSofitSyncOptions = {
  entidades: SofitEntity[];
  period: SofitPeriod;
  origem: SofitSyncOrigem;
  executadoPor?: string | null;
  deadline?: number;
};

// Busca no Sofit e grava no banco, uma entidade por vez, registrando um
// SofitSyncLog por entidade. Nunca lanca: falha de uma entidade (rede,
// credencial, caminho errado) vira `sucesso: false` no resultado dela e as
// outras seguem — perder a sincronizacao de abastecimento porque o caminho
// de manutencao esta errado seria pior que o problema original.
export async function runSofitSync(
  companyId: string,
  options: RunSofitSyncOptions
): Promise<SofitSyncEntityResult[]> {
  const results: SofitSyncEntityResult[] = [];

  for (const entidade of options.entidades) {
    const started = Date.now();
    let result = emptyResult(entidade);
    let sucesso = true;

    try {
      switch (entidade) {
        case "VEICULOS": {
          const fetched = await fetchSofitVehicles(options.deadline);
          result = await syncVehiclesIntoDb(companyId, fetched.items);
          result.lidos = fetched.lidosBrutos;
          result.erros.push(...fetched.erros);
          break;
        }
        case "ABASTECIMENTOS": {
          const fetched = await fetchSofitFuelSupplies(options.period, options.deadline);
          result = await syncFuelSuppliesIntoDb(companyId, fetched.items);
          result.lidos = fetched.lidosBrutos;
          result.erros.push(...fetched.erros);
          break;
        }
        case "MANUTENCOES": {
          const fetched = await fetchSofitMaintenances(options.period, options.deadline);
          result = await syncMaintenancesIntoDb(companyId, fetched.items);
          result.lidos = fetched.lidosBrutos;
          result.erros.push(...fetched.erros);
          break;
        }
        case "ODOMETRO": {
          const fetched = await fetchSofitOdometerReadings(options.period, options.deadline);
          result = await syncOdometerIntoDb(companyId, fetched.items);
          result.lidos = fetched.lidosBrutos;
          result.erros.push(...fetched.erros);
          break;
        }
      }
    } catch (e) {
      sucesso = false;
      result.erros.push(e instanceof Error ? e.message : "Falha desconhecida ao sincronizar com o Sofit.");
    }

    await registrarSyncLog(companyId, {
      entidade,
      origem: options.origem,
      periodoInicio: entidade === "VEICULOS" ? null : options.period.start,
      periodoFim: entidade === "VEICULOS" ? null : options.period.end,
      result,
      sucesso,
      duracaoMs: Date.now() - started,
      executadoPor: options.executadoPor ?? null,
    });

    results.push(result);
  }

  return results;
}

export async function registrarSyncLog(
  companyId: string,
  params: {
    entidade: SofitEntity;
    origem: SofitSyncOrigem;
    periodoInicio: Date | null;
    periodoFim: Date | null;
    result: SofitSyncEntityResult;
    sucesso: boolean;
    duracaoMs: number;
    executadoPor: string | null;
  }
): Promise<void> {
  const mensagens = [
    ...params.result.erros.map((texto) => ({ tipo: "erro" as const, texto })),
    ...params.result.avisos.map((texto) => ({ tipo: "aviso" as const, texto })),
  ];
  const truncadas = mensagens.length > MAX_MENSAGENS_LOG;

  await prisma.sofitSyncLog.create({
    data: {
      companyId,
      entidade: params.entidade,
      origem: params.origem,
      periodoInicio: params.periodoInicio,
      periodoFim: params.periodoFim,
      lidos: params.result.lidos,
      criados: params.result.criados,
      atualizados: params.result.atualizados,
      ignorados: params.result.ignorados,
      // `sucesso` e sobre a EXECUCAO (rede, credencial, gravacao), nao sobre
      // os itens: um registro problematico la no Sofit (veiculo sem placa,
      // por exemplo) fica pra sempre no cadastro deles e apareceria em toda
      // execucao. Se isso marcasse a execucao como falha, o marco
      // incremental (ultimoSyncComSucesso) nunca avancaria e o cron
      // reimportaria a mesma janela pra sempre. Erros de item vao pra
      // `mensagens` e a tela mostra a execucao como "Parcial".
      sucesso: params.sucesso,
      duracaoMs: params.duracaoMs,
      executadoPor: params.executadoPor,
      mensagens: mensagens.length
        ? [
            ...mensagens.slice(0, MAX_MENSAGENS_LOG),
            ...(truncadas
              ? [{ tipo: "aviso" as const, texto: `… e mais ${mensagens.length - MAX_MENSAGENS_LOG} mensagem(ns).` }]
              : []),
          ]
        : undefined,
    },
  });
}

// Marco pra sincronizacao incremental: fim do periodo da ultima execucao
// BEM-SUCEDIDA desta entidade. O cron usa isso pra nao reimportar o
// historico inteiro todo dia — e, quando uma execucao falha, a proxima
// naturalmente refaz o periodo perdido (o marco so anda com sucesso).
export async function ultimoSyncComSucesso(
  companyId: string,
  entidade: SofitEntity
): Promise<Date | null> {
  const log = await prisma.sofitSyncLog.findFirst({
    where: { companyId, entidade, sucesso: true },
    orderBy: { createdAt: "desc" },
    select: { periodoFim: true, createdAt: true },
  });
  if (!log) return null;
  return log.periodoFim ?? log.createdAt;
}
