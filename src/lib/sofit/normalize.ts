// Traducao do JSON cru do Sofit para os nossos tipos normalizados.
//
// TODO o conhecimento sobre "como o Sofit chama cada campo" mora aqui — e so
// aqui. O resto da integracao (client, importCore, UI, cron) trabalha com
// SofitVehicle/SofitFuelSupply/... e nao sabe nada sobre o formato de origem.
//
// A busca de campo e por APELIDOS, nao por nome exato, porque a API do Sofit
// e liberada por contrato e o mapeamento de campos e acordado na implantacao
// de cada cliente (o material publico deles fala explicitamente em
// "mapeamento de campos e colunas"): a mesma informacao pode chegar como
// "placa", "veiculoPlaca", "vehicle_plate" ou aninhada em
// { veiculo: { placa } }. A comparacao normaliza caixa, acento e separador,
// entao "Data Transação", "dataTransacao" e "data_transacao" sao a mesma
// chave. Quando o contrato real chegar, o certo e ENXUGAR estas listas para
// os nomes confirmados — nao adicionar logica nova em outros arquivos.

import { parseLocalDate } from "@/lib/date";
import type {
  SofitDriver,
  SofitFuelSupply,
  SofitMaintenance,
  SofitOdometerReading,
  SofitVehicle,
  SofitVehicleStatus,
} from "./types";

export type NormalizeResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function fail<T>(reason: string): NormalizeResult<T> {
  return { ok: false, reason };
}

// "Data Transação" -> "datatransacao"; "vehicle_plate" -> "vehicleplate".
function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Achata um nivel de aninhamento: { veiculo: { placa: "ABC1D23" } } vira as
// chaves "veiculoplaca" E "placa" (a segunda so se ainda nao existir no
// nivel de cima, que sempre tem precedencia). Cobre as duas formas que o
// mesmo dado costuma chegar sem precisar de duas listas de apelidos.
function flatten(raw: Record<string, unknown>): Map<string, unknown> {
  const flat = new Map<string, unknown>();
  for (const [key, value] of Object.entries(raw)) {
    flat.set(normalizeKey(key), value);
  }
  for (const [key, value] of Object.entries(raw)) {
    const nested = asRecord(value);
    if (!nested) continue;
    const prefix = normalizeKey(key);
    for (const [childKey, childValue] of Object.entries(nested)) {
      if (asRecord(childValue)) continue; // so um nivel — nada de recursao infinita
      const child = normalizeKey(childKey);
      flat.set(`${prefix}${child}`, childValue);
      if (!flat.has(child)) flat.set(child, childValue);
    }
  }
  return flat;
}

function pick(flat: Map<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    const value = flat.get(normalizeKey(alias));
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function pickString(flat: Map<string, unknown>, aliases: string[]): string | null {
  const value = pick(flat, aliases);
  if (value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

// Numero em formato brasileiro ou americano. "1.234,56" -> 1234.56;
// "1,234.56" -> 1234.56; "1234.56" -> 1234.56; "1.234" -> 1234 (ponto como
// separador de milhar, que e como o Sofit exporta hodometro em relatorio).
// A regra: o ULTIMO separador decide o que e decimal, e ponto so e decimal
// quando nao ha virgula e sobram != 3 casas depois dele.
export function parseSofitNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s/g, "").replace(/R\$/i, "");
  if (!text) return null;

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  let cleaned: string;
  if (hasComma && hasDot) {
    cleaned = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".") // 1.234,56
      : text.replace(/,/g, ""); // 1,234.56
  } else if (hasComma) {
    cleaned = text.replace(",", ".");
  } else if (hasDot) {
    const decimals = text.length - text.lastIndexOf(".") - 1;
    cleaned = decimals === 3 ? text.replace(/\./g, "") : text; // 1.234 e milhar, 1.23 e decimal
  } else {
    cleaned = text;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSofitInt(value: unknown): number | null {
  const parsed = parseSofitNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

export function parseSofitCents(value: unknown): number | null {
  const parsed = parseSofitNumber(value);
  return parsed === null ? null : Math.round(parsed * 100);
}

// Aceita ISO com ou sem fuso, "DD/MM/AAAA[ HH:mm[:ss]]" e "AAAA-MM-DD
// HH:mm[:ss]". Cuidado central de fuso (mesmo motivo documentado em
// src/lib/date.ts): data-SÓ ("2026-08-19") nunca pode passar por
// `new Date(string)`, que a interpreta como meia-noite UTC e, em UTC-3,
// volta um dia no calendario local. Datetime SEM fuso ja e interpretado
// como local pelo proprio JS, entao esse caminho e seguro.
export function parseSofitDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const fromEpoch = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = parseLocalDate(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (br) {
    const [, d, m, y, h, min, s] = br;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(h ?? 0), Number(min ?? 0), Number(s ?? 0));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(text.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseSofitBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return null;
  const text = normalizeKey(value);
  if (["true", "sim", "s", "1", "concluida", "concluido", "finalizada", "finalizado", "encerrada", "fechada", "realizada"].includes(text)) {
    return true;
  }
  if (["false", "nao", "n", "0", "aberta", "aberto", "pendente", "emandamento", "agendada", "cancelada"].includes(text)) {
    return false;
  }
  return null;
}

export function onlyDigits(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits || null;
}

// Placa no mesmo formato do nosso cadastro (Vehicle.plate e gravada em
// maiuscula, sem espaco — ver importVehicles em cadastros/veiculos/actions).
// Aceita padrao antigo (ABC1234) e Mercosul (ABC1D23); qualquer outra coisa
// vira null pra virar erro reportado, nunca um veiculo fantasma no cadastro.
export function normalizePlate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const plate = String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate)) return null;
  return plate;
}

function normalizeStatus(value: string | null): SofitVehicleStatus | null {
  if (!value) return null;
  const text = normalizeKey(value);
  if (["ativo", "ativa", "disponivel", "emoperacao", "operacional", "emuso", "1"].includes(text)) return "ATIVO";
  if (["manutencao", "emmanutencao", "oficina", "parado", "indisponivel"].includes(text)) return "MANUTENCAO";
  if (["inativo", "inativa", "baixado", "baixada", "vendido", "vendida", "desativado", "desativada", "0"].includes(text)) {
    return "INATIVO";
  }
  return null;
}

// ---------- Apelidos por campo ----------
// Listas em ordem de preferencia: o primeiro apelido presente vence.

const PLATE_ALIASES = ["placa", "veiculoPlaca", "placaVeiculo", "plate", "vehiclePlate", "licensePlate"];
const ODOMETER_ALIASES = [
  "hodometro",
  "odometro",
  "kmAtual",
  "quilometragem",
  "kmRodado",
  "km",
  "odometer",
  "mileage",
  "hodometroAtual",
  "ultimoHodometro",
];
const DRIVER_NAME_ALIASES = ["motorista", "motoristaNome", "nomeMotorista", "condutor", "condutorNome", "driver", "driverName"];
const CPF_ALIASES = ["cpf", "motoristaCpf", "cpfMotorista", "condutorCpf", "documento"];

export function normalizeVehicle(raw: unknown): NormalizeResult<SofitVehicle> {
  const record = asRecord(raw);
  if (!record) return fail("Item de veículo não é um objeto JSON.");
  const flat = flatten(record);

  const plate = normalizePlate(pickString(flat, PLATE_ALIASES));
  if (!plate) {
    return fail(`Veículo sem placa válida no Sofit (recebido: "${pickString(flat, PLATE_ALIASES) ?? "vazio"}").`);
  }

  const year = parseSofitInt(pick(flat, ["ano", "anoModelo", "anoFabricacao", "year", "modelYear"]));
  return {
    ok: true,
    value: {
      externalId: pickString(flat, ["id", "codigo", "idVeiculo", "veiculoId", "externalId"]),
      plate,
      brand: pickString(flat, ["marca", "fabricante", "brand", "manufacturer"]),
      model: pickString(flat, ["modelo", "descricaoModelo", "model", "modeloVeiculo"]),
      // Ano fora de faixa plausivel (ex. 0, 99, 3000) e tratado como ausente
      // — melhor cadastrar sem ano e avisar do que gravar lixo no cadastro.
      year: year !== null && year >= 1950 && year <= 2100 ? year : null,
      type: pickString(flat, ["tipo", "tipoVeiculo", "categoria", "type", "vehicleType"]),
      status: normalizeStatus(pickString(flat, ["situacao", "status", "situacaoVeiculo", "ativo"])),
      odometer: parseSofitInt(pick(flat, ODOMETER_ALIASES)),
    },
  };
}

export function normalizeFuelSupply(raw: unknown): NormalizeResult<SofitFuelSupply> {
  const record = asRecord(raw);
  if (!record) return fail("Item de abastecimento não é um objeto JSON.");
  const flat = flatten(record);

  const plateRaw = pickString(flat, PLATE_ALIASES);
  const plate = normalizePlate(plateRaw);
  if (!plate) return fail(`Abastecimento sem placa válida (recebido: "${plateRaw ?? "vazio"}").`);

  const dataHora = parseSofitDate(
    pick(flat, ["dataHora", "dataAbastecimento", "data", "dataTransacao", "date", "dataHoraAbastecimento", "emissao"])
  );
  if (!dataHora) return fail(`Abastecimento da placa ${plate} sem data/hora reconhecível.`);

  const volumeLitros = parseSofitNumber(pick(flat, ["litros", "quantidade", "volume", "qtdeLitros", "liters", "quantidadeLitros"]));
  if (volumeLitros === null || volumeLitros <= 0) {
    return fail(`Abastecimento da placa ${plate} sem volume em litros válido.`);
  }

  // Valor total quando vier; senao, reconstroi de preco unitario x litros
  // (varias exportacoes de frota so trazem o unitario).
  let valorCents = parseSofitCents(pick(flat, ["valorTotal", "valor", "custoTotal", "total", "vlrTotal", "amount"]));
  if (valorCents === null) {
    const unitario = parseSofitNumber(pick(flat, ["valorUnitario", "precoUnitario", "precoLitro", "valorLitro", "unitPrice"]));
    if (unitario !== null && unitario > 0) valorCents = Math.round(unitario * volumeLitros * 100);
  }
  if (valorCents === null || valorCents <= 0) {
    return fail(`Abastecimento da placa ${plate} sem valor válido.`);
  }

  return {
    ok: true,
    value: {
      externalId: pickString(flat, ["id", "codigo", "idAbastecimento", "abastecimentoId", "numeroDocumento", "externalId"]),
      plate,
      dataHora,
      valorCents,
      volumeLitros,
      combustivel: pickString(flat, ["combustivel", "tipoCombustivel", "produto", "fuelType"]),
      posto: pickString(flat, ["posto", "estabelecimento", "fornecedor", "razaoSocial", "station"]),
      cidade: pickString(flat, ["cidade", "municipio", "city"]),
      uf: pickString(flat, ["uf", "estado", "state"])?.toUpperCase().slice(0, 2) ?? null,
      hodometro: parseSofitInt(pick(flat, ODOMETER_ALIASES)),
      motoristaNome: pickString(flat, DRIVER_NAME_ALIASES),
      motoristaCpf: onlyDigits(pickString(flat, CPF_ALIASES)),
    },
  };
}

export function normalizeMaintenance(raw: unknown): NormalizeResult<SofitMaintenance> {
  const record = asRecord(raw);
  if (!record) return fail("Item de manutenção não é um objeto JSON.");
  const flat = flatten(record);

  const plateRaw = pickString(flat, PLATE_ALIASES);
  const plate = normalizePlate(plateRaw);
  if (!plate) return fail(`Manutenção sem placa válida (recebido: "${plateRaw ?? "vazio"}").`);

  // Sem sinal explicito de conclusao, assume concluida: o caso normal de uma
  // manutencao aparecer na API com data e hodometro e ela ja ter acontecido.
  const concluida =
    parseSofitBoolean(pick(flat, ["concluida", "finalizada", "encerrada", "realizada", "status", "situacao"])) ?? true;

  return {
    ok: true,
    value: {
      externalId: pickString(flat, ["id", "codigo", "idManutencao", "ordemServico", "os", "externalId"]),
      plate,
      data: parseSofitDate(pick(flat, ["dataConclusao", "dataFim", "dataEncerramento", "data", "dataManutencao", "dataServico"])),
      hodometro: parseSofitInt(pick(flat, ODOMETER_ALIASES)),
      tipo: pickString(flat, ["tipo", "tipoManutencao", "natureza", "type"]),
      descricao: pickString(flat, ["descricao", "servico", "observacao", "obs", "description"]),
      concluida,
      valorCents: parseSofitCents(pick(flat, ["valorTotal", "valor", "custoTotal", "total"])),
    },
  };
}

export function normalizeOdometerReading(raw: unknown): NormalizeResult<SofitOdometerReading> {
  const record = asRecord(raw);
  if (!record) return fail("Item de odômetro não é um objeto JSON.");
  const flat = flatten(record);

  const plateRaw = pickString(flat, PLATE_ALIASES);
  const plate = normalizePlate(plateRaw);
  if (!plate) return fail(`Leitura de odômetro sem placa válida (recebido: "${plateRaw ?? "vazio"}").`);

  const hodometro = parseSofitInt(pick(flat, ODOMETER_ALIASES));
  if (hodometro === null || hodometro < 0) return fail(`Leitura de odômetro da placa ${plate} sem valor de km válido.`);

  return {
    ok: true,
    value: {
      plate,
      hodometro,
      data: parseSofitDate(pick(flat, ["dataHora", "data", "dataLeitura", "date", "dataRegistro"])),
    },
  };
}

export function normalizeDriver(raw: unknown): NormalizeResult<SofitDriver> {
  const record = asRecord(raw);
  if (!record) return fail("Item de motorista não é um objeto JSON.");
  const flat = flatten(record);

  const nome = pickString(flat, ["nome", "nomeCompleto", "motorista", "condutor", "name", "fullName"]);
  if (!nome) return fail("Motorista sem nome no Sofit.");

  return {
    ok: true,
    value: {
      externalId: pickString(flat, ["id", "codigo", "idMotorista", "motoristaId", "externalId"]),
      nome,
      cpf: onlyDigits(pickString(flat, CPF_ALIASES)),
      cnh: onlyDigits(pickString(flat, ["cnh", "numeroCnh", "registroCnh", "habilitacao"])),
      categoriaCnh: pickString(flat, ["categoriaCnh", "categoria", "categoriaHabilitacao"])?.toUpperCase() ?? null,
      validadeCnh: parseSofitDate(pick(flat, ["validadeCnh", "vencimentoCnh", "dataValidadeCnh"])),
    },
  };
}
