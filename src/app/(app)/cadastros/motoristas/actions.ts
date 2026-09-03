"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { readWorkbookRows, normalizeText, cellToLocalDateString } from "@/lib/spreadsheet";
import { fetchAllEmployees, fetchPaymentSources } from "@/lib/tiquetaque/client";
import { parsePayrollWorkbook, type PayrollRow } from "@/lib/payrollImport";
import { isValidCPF, normalizeCpf } from "@/lib/cpf";
import { findSindicatoMatch, suggestSindicatoMatch } from "@/lib/sindicatoMatch";

const schema = z.object({
  name: z.string().min(2, "Informe o nome do motorista"),
  cpf: z.string().min(11, "CPF inválido"),
  // Opcionais: motoristas importados do TiqueTaque nao tem esses dados —
  // ficam "CNH pendente" (src/lib/driverAlerts.ts) ate serem completados.
  cnh: z.string().min(5, "Informe o número da CNH").optional(),
  cnhCategory: z.string().min(1, "Informe a categoria").optional(),
  cnhExpiration: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .transform(parseLocalDate)
    .optional(),
  phone: z.string().optional(),
  sindicatoId: z.string().optional(),
  clienteId: z.string().optional(),
  // Data de admissao — opcional, nao vem do TiqueTaque. Sem ela o sistema
  // nao calcula ferias em dobro (art. 137 CLT) nem periodo aquisitivo de
  // ferias em geral, ver checkFolgaCompensada em afastamentoCompliance.ts.
  admissao: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .transform(parseLocalDate)
    .optional(),
  regimeHoras: z.enum(["PADRAO", "DOZE_X_TRINTA_SEIS"]).optional(),
  escalaSemanal: z.enum(["SEIS_UM", "CINCO_DOIS"]).optional(),
  // Le do input "valorHora" (reais, ex.: "12,50") e converte pra centavos —
  // o nome do campo do schema ja e o nome da coluna no Prisma.
  valorHoraCents: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const num = parseFloat(v.replace(",", "."));
      return Number.isFinite(num) ? Math.round(num * 100) : undefined;
    }),
});

function parseForm(formData: FormData) {
  return schema.parse({
    name: formData.get("name"),
    cpf: formData.get("cpf"),
    cnh: formData.get("cnh") || undefined,
    cnhCategory: formData.get("cnhCategory") || undefined,
    cnhExpiration: formData.get("cnhExpiration") || undefined,
    phone: formData.get("phone") || undefined,
    sindicatoId: formData.get("sindicatoId") || undefined,
    clienteId: formData.get("clienteId") || undefined,
    admissao: formData.get("admissao") || undefined,
    regimeHoras: formData.get("regimeHoras") || undefined,
    escalaSemanal: formData.get("escalaSemanal") || undefined,
    valorHoraCents: formData.get("valorHora") || undefined,
  });
}

export async function createDriver(formData: FormData) {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);

  await prisma.driver.create({
    data: { ...parsed, companyId: session.companyId },
  });

  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
  redirect("/cadastros/motoristas");
}

export async function updateDriver(id: string, formData: FormData) {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);

  await prisma.driver.update({
    where: { id, companyId: session.companyId },
    data: parsed,
  });

  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
  redirect("/cadastros/motoristas");
}

export async function toggleDriverActive(id: string, active: boolean) {
  const session = await requireRole("ADMIN", "GESTOR");
  await prisma.driver.update({
    where: { id, companyId: session.companyId },
    data: { active },
  });
  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
}

export type ImportRowError = { row: number; message: string };
export type ImportResult = { created: number; updated?: number; errors: ImportRowError[] };
export type ImportState = { error?: string; result?: ImportResult };

function normalizeRegimeHoras(value: string): "PADRAO" | "DOZE_X_TRINTA_SEIS" | null {
  const v = value.trim().toLowerCase();
  if (v === "padrao" || v === "padrão") return "PADRAO";
  if (v === "12x36" || v === "12 x 36") return "DOZE_X_TRINTA_SEIS";
  return null;
}

function normalizeEscalaSemanal(value: string): "SEIS_UM" | "CINCO_DOIS" | null {
  const v = value.trim().toLowerCase();
  if (v === "6x1" || v === "6 x 1") return "SEIS_UM";
  if (v === "5x2" || v === "5 x 2") return "CINCO_DOIS";
  return null;
}

// Mesma validacao de createDriver, linha a linha, com melhor esforco: linhas
// invalidas viram erro reportado ao usuario, mas nao bloqueiam a importacao
// das linhas validas do resto da planilha.
export async function importDrivers(
  _prevState: ImportState,
  formData: FormData
): Promise<ImportState> {
  const session = await requireRole("ADMIN", "GESTOR");

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { error: "Selecione o arquivo da planilha (.xlsx)." };
  }

  let rows: Record<string, unknown>[];
  try {
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    rows = await readWorkbookRows(buffer);
  } catch {
    return { error: "Não foi possível ler o arquivo. Baixe o modelo de planilha e tente novamente." };
  }
  if (rows.length === 0) {
    return { error: "A planilha está vazia." };
  }

  const [sindicatos, clientes, existingDrivers] = await Promise.all([
    prisma.sindicato.findMany({ where: { companyId: session.companyId }, select: { id: true, nome: true } }),
    prisma.cliente.findMany({ where: { companyId: session.companyId }, select: { id: true, nome: true } }),
    prisma.driver.findMany({ where: { companyId: session.companyId }, select: { id: true, cpf: true } }),
  ]);
  const sindicatoByName = new Map(sindicatos.map((s) => [s.nome.trim().toLowerCase(), s.id]));
  const clienteByName = new Map(clientes.map((c) => [c.nome.trim().toLowerCase(), c.id]));
  const existingDriverByCpf = new Map(existingDrivers.map((d) => [d.cpf, d.id]));

  const errors: ImportRowError[] = [];
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // linha 1 e o cabecalho

    const name = normalizeText(row["Nome"]);
    const cpf = normalizeText(row["CPF"]).replace(/\D/g, "");
    const cnh = normalizeText(row["CNH"]);
    if (!name && !cpf && !cnh) continue; // linha em branco, ignora

    const cnhCategory = normalizeText(row["Categoria CNH"]);
    const cnhExpiration = cellToLocalDateString(row["Validade CNH (AAAA-MM-DD)"]);
    const admissao = cellToLocalDateString(row["Data de Admissão (AAAA-MM-DD)"]);
    const phone = normalizeText(row["Telefone"]) || undefined;
    const sindicatoNome = normalizeText(row["Sindicato"]);
    const centroCustoNome = normalizeText(row["Centro de Custos"]);
    const funcao = normalizeText(row["Função"]) || undefined;
    const ativoRaw = normalizeText(row["Ativo (SIM/NAO)"]).toLowerCase();
    const regimeHorasText = normalizeText(row["Regime de Horas"]);
    const escalaSemanalText = normalizeText(row["Escala"]);
    const valorHoraText = normalizeText(row["Valor da Hora (R$)"]) || undefined;

    let sindicatoId: string | undefined;
    if (sindicatoNome) {
      const match = sindicatoByName.get(sindicatoNome.toLowerCase());
      if (!match) {
        errors.push({ row: rowNumber, message: `Sindicato "${sindicatoNome}" não encontrado` });
        continue;
      }
      sindicatoId = match;
    }

    let clienteId: string | undefined;
    if (centroCustoNome) {
      const match = clienteByName.get(centroCustoNome.toLowerCase());
      if (!match) {
        errors.push({ row: rowNumber, message: `Centro de Custos "${centroCustoNome}" não encontrado` });
        continue;
      }
      clienteId = match;
    }

    // CPF ja cadastrado: so atualiza Centro de Custos/Funcao (o resto do
    // cadastro existente fica intocado, mesmo que a planilha traga outro
    // valor pras demais colunas — decisao explicita do usuario, pra nao
    // arriscar sobrescrever dado real dos 310 motoristas em produção com
    // uma planilha que pode nao ser um espelho perfeito do cadastro atual).
    const existingId = existingDriverByCpf.get(cpf);
    if (existingId) {
      if (clienteId === undefined && funcao === undefined) continue; // nada pra atualizar nessa linha
      await prisma.driver.update({
        where: { id: existingId },
        data: { clienteId, funcao },
      });
      updated++;
      continue;
    }

    const regimeHoras = regimeHorasText ? normalizeRegimeHoras(regimeHorasText) : undefined;
    if (regimeHorasText && !regimeHoras) {
      errors.push({ row: rowNumber, message: `Regime de horas "${regimeHorasText}" inválido (use Padrão ou 12x36)` });
      continue;
    }
    const escalaSemanal = escalaSemanalText ? normalizeEscalaSemanal(escalaSemanalText) : undefined;
    if (escalaSemanalText && !escalaSemanal) {
      errors.push({ row: rowNumber, message: `Escala "${escalaSemanalText}" inválida (use 6x1 ou 5x2)` });
      continue;
    }

    const parsed = schema.safeParse({
      name,
      cpf,
      cnh: cnh || undefined,
      cnhCategory: cnhCategory || undefined,
      cnhExpiration: cnhExpiration ?? undefined,
      admissao: admissao ?? undefined,
      phone,
      sindicatoId,
      clienteId,
      regimeHoras: regimeHoras ?? undefined,
      escalaSemanal: escalaSemanal ?? undefined,
      valorHoraCents: valorHoraText,
    });
    if (!parsed.success) {
      errors.push({ row: rowNumber, message: parsed.error.issues[0]?.message ?? "Dados inválidos" });
      continue;
    }

    try {
      const createdDriver = await prisma.driver.create({
        data: {
          ...parsed.data,
          funcao,
          active: ativoRaw !== "nao" && ativoRaw !== "não",
          companyId: session.companyId,
        },
      });
      existingDriverByCpf.set(parsed.data.cpf, createdDriver.id);
      created++;
    } catch {
      errors.push({ row: rowNumber, message: "Erro ao salvar a linha (CPF duplicado?)" });
    }
  }

  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
  return { result: { created, updated, errors } };
}

export type TiqueTaqueDriverImportRowError = { name: string; cpf: string; message: string };
export type TiqueTaqueDriverImportResult = { created: number; errors: TiqueTaqueDriverImportRowError[] };
export type TiqueTaqueDriverImportState = { error?: string; result?: TiqueTaqueDriverImportResult };

// Traz TODOS os funcionarios ATIVOS do TiqueTaque (nao so cargo
// "motorista") — o cadastro serve de base unica de pessoal da empresa.
// CNH nao existe no TiqueTaque — fica pendente (nulo) ate ser completada
// manualmente, ver src/lib/driverAlerts.ts. Um unico `createMany` para os
// novos registros (nao um loop de create() por funcionario) — com
// potencialmente centenas de funcionarios ativos, um loop sequencial
// correria o mesmo risco de timeout que a importacao de ponto teve que
// corrigir (ver src/app/(app)/ponto/actions.ts).
export async function importDriversFromTiqueTaque(): Promise<TiqueTaqueDriverImportState> {
  const session = await requireRole("ADMIN", "GESTOR");

  let employees;
  let paymentSources;
  try {
    [employees, paymentSources] = await Promise.all([fetchAllEmployees(), fetchPaymentSources()]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao buscar funcionários do TiqueTaque." };
  }

  const activeEmployees = employees.filter((e) => !e.dismissed);

  const existingCpfs = new Set(
    (await prisma.driver.findMany({ where: { companyId: session.companyId }, select: { cpf: true } })).map(
      (d) => d.cpf
    )
  );

  const errors: TiqueTaqueDriverImportRowError[] = [];
  const toCreate: {
    companyId: string;
    name: string;
    cpf: string;
    phone: string | null;
    valorHoraCents: number | null;
    empregador: string | null;
    departamento: string | null;
    funcao: string | null;
  }[] = [];

  for (const emp of activeEmployees) {
    const cpf = emp.cpf.replace(/\D/g, "");
    if (cpf.length < 11) {
      errors.push({ name: emp.fullName, cpf: emp.cpf, message: "CPF inválido no TiqueTaque." });
      continue;
    }
    if (existingCpfs.has(cpf)) {
      errors.push({ name: emp.fullName, cpf, message: "CPF já cadastrado." });
      continue;
    }
    existingCpfs.add(cpf); // evita duplicar se o TiqueTaque repetir o mesmo CPF em dois registros
    toCreate.push({
      companyId: session.companyId,
      name: emp.fullName,
      cpf,
      phone: emp.mobilePhone,
      valorHoraCents: emp.hourRateCents,
      empregador: emp.paymentSourceId ? paymentSources.get(emp.paymentSourceId) ?? null : null,
      departamento: emp.department,
      funcao: emp.jobRole || null,
    });
  }

  if (toCreate.length > 0) {
    await prisma.driver.createMany({ data: toCreate });
  }

  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
  return { result: { created: toCreate.length, errors } };
}

export type PayrollImportRowError = { row: number; message: string };
export type PayrollImportResult = {
  created: number;
  updated: number;
  sindicatoNaoEncontrado: number;
  errors: PayrollImportRowError[];
};
export type PayrollImportState = { error?: string; result?: PayrollImportResult };

// Importa a exportacao "Empregados em Excel" da folha de pagamento (.xls ou
// .xlsx, formato bem diferente do modelo proprio do app — ver
// src/lib/payrollImport.ts). O empregador (razao social) nao vem como
// coluna no arquivo: cada exportacao e de UMA empresa so, entao quem sobe o
// arquivo informa no formulario.
//
// Mesma politica conservadora do importDrivers manual: CPF ja cadastrado
// nao tem o cadastro inteiro sobrescrito, so empregador/unidade de
// alocacao/funcao sao atualizados — o resto (CNH, telefone, admissao etc.
// editados manualmente depois da primeira importacao) fica intocado.
export async function importDriversFromPayrollFile(
  _prevState: PayrollImportState,
  formData: FormData
): Promise<PayrollImportState> {
  const session = await requireRole("ADMIN", "GESTOR");

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { error: "Selecione o arquivo da folha de pagamento (.xls ou .xlsx)." };
  }
  const empregador = normalizeText(formData.get("empregador"));
  if (!empregador) {
    return { error: "Informe o empregador (razão social) deste arquivo." };
  }

  let rows: PayrollRow[];
  try {
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    rows = parsePayrollWorkbook(buffer);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Não foi possível ler o arquivo." };
  }
  if (rows.length === 0) {
    return { error: "A planilha não tem linhas de dados." };
  }

  const [sindicatos, existingDrivers] = await Promise.all([
    prisma.sindicato.findMany({ where: { companyId: session.companyId }, select: { id: true, nome: true } }),
    prisma.driver.findMany({
      where: { companyId: session.companyId },
      select: { id: true, cpf: true, sindicatoId: true },
    }),
  ]);
  // CPF ja cadastrado pode ou nao ter pontuacao, dependendo de como foi
  // criado — normaliza os dois lados antes de comparar (mesmo cuidado do
  // bug real ja corrigido em cadastros/clientes/actions.ts).
  const existingDriverByCpf = new Map(existingDrivers.map((d) => [normalizeCpf(d.cpf), d]));

  const errors: PayrollImportRowError[] = [];
  let created = 0;
  let updated = 0;
  let sindicatoNaoEncontrado = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // linha 1 e o cabecalho

    if (!row.ativo) continue; // seguranca extra, mesmo o arquivo sendo "apenas ativos"
    if (!row.nome) {
      errors.push({ row: rowNumber, message: "Nome em branco" });
      continue;
    }
    if (!isValidCPF(row.cpf)) {
      errors.push({ row: rowNumber, message: `CPF inválido para "${row.nome}" (${row.cpf})` });
      continue;
    }

    const sindicatoMatch = row.sindicato ? findSindicatoMatch(row.sindicato, sindicatos) : null;
    const sindicatoId = sindicatoMatch?.id;
    if (row.sindicato && !sindicatoId) sindicatoNaoEncontrado++;

    const existing = existingDriverByCpf.get(row.cpf);
    if (existing) {
      await prisma.driver.update({
        where: { id: existing.id },
        data: {
          empregador,
          departamento: row.departamento || undefined,
          funcao: row.funcao || undefined,
          // So preenche sindicato de quem ainda nao tem (nunca sobrescreve
          // um ja vinculado) — cobre o caso de reimportar a mesma planilha
          // depois de cadastrar o sindicato que faltava (antes disso o
          // motorista ficou sem sindicato porque o cadastro nao existia
          // no momento da primeira importacao).
          sindicatoId: existing.sindicatoId == null ? sindicatoId : undefined,
        },
      });
      updated++;
      continue;
    }

    try {
      const createdDriver = await prisma.driver.create({
        data: {
          companyId: session.companyId,
          name: row.nome,
          cpf: row.cpf,
          cnh: row.cnh || undefined,
          cnhCategory: row.cnhCategory || undefined,
          cnhExpiration: row.cnhExpiration ? parseLocalDate(row.cnhExpiration) : undefined,
          admissao: row.admissao ? parseLocalDate(row.admissao) : undefined,
          phone: row.telefone || undefined,
          empregador,
          departamento: row.departamento || undefined,
          funcao: row.funcao || undefined,
          sindicatoId,
          active: true,
        },
      });
      existingDriverByCpf.set(row.cpf, { id: createdDriver.id, cpf: row.cpf, sindicatoId: sindicatoId ?? null });
      created++;
    } catch {
      errors.push({ row: rowNumber, message: "Erro ao salvar a linha (CPF duplicado?)" });
    }
  }

  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
  return { result: { created, updated, sindicatoNaoEncontrado, errors } };
}

export type SindicatoDivergencia = {
  textoNaPlanilha: string;
  qtd: number;
  status: "encontrado" | "sugestao" | "sem_correspondencia";
  sindicatoEncontrado?: string;
  sugestao?: { nome: string; score: number };
};
export type PreviewSindicatosResult = { divergencias: SindicatoDivergencia[] };
export type PreviewSindicatosState = { error?: string; result?: PreviewSindicatosResult };

// So le a planilha e compara os sindicatos citados contra o cadastro — nao
// grava nada. Serve pra responder "quais nomes estao divergindo" antes de
// importar de verdade, com sugestao por similaridade (Dice coefficient
// sobre palavras significativas) pros que nem batem por substring.
export async function previewPayrollSindicatos(
  _prevState: PreviewSindicatosState,
  formData: FormData
): Promise<PreviewSindicatosState> {
  const session = await requireRole("ADMIN", "GESTOR");

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { error: "Selecione o arquivo da folha de pagamento (.xls ou .xlsx)." };
  }

  let rows: PayrollRow[];
  try {
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    rows = parsePayrollWorkbook(buffer);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Não foi possível ler o arquivo." };
  }

  const sindicatos = await prisma.sindicato.findMany({
    where: { companyId: session.companyId },
    select: { id: true, nome: true },
  });

  const countByText = new Map<string, number>();
  for (const row of rows) {
    if (!row.ativo || !row.sindicato) continue;
    countByText.set(row.sindicato, (countByText.get(row.sindicato) ?? 0) + 1);
  }

  const divergencias: SindicatoDivergencia[] = [...countByText.entries()]
    .map(([textoNaPlanilha, qtd]) => {
      const match = findSindicatoMatch(textoNaPlanilha, sindicatos);
      if (match) {
        return { textoNaPlanilha, qtd, status: "encontrado" as const, sindicatoEncontrado: match.nome };
      }
      const suggestion = suggestSindicatoMatch(textoNaPlanilha, sindicatos);
      if (suggestion && suggestion.score >= 0.3) {
        return {
          textoNaPlanilha,
          qtd,
          status: "sugestao" as const,
          sugestao: { nome: suggestion.sindicato.nome, score: Math.round(suggestion.score * 100) / 100 },
        };
      }
      return { textoNaPlanilha, qtd, status: "sem_correspondencia" as const };
    })
    .sort((a, b) => b.qtd - a.qtd);

  return { result: { divergencias } };
}

const MERGE_TEXT_FIELDS = ["empregador", "departamento", "funcao"] as const;
const MERGE_FIELDS = [...MERGE_TEXT_FIELDS, "sindicato"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeFieldResult = { updated: number };
export type MergeFieldState = { error?: string; result?: MergeFieldResult };

// Empregador/unidade de alocacao/cargo sao texto livre vindo de fontes
// diferentes (TiqueTaque, folha de pagamento, cadastro manual) — a mesma
// empresa/unidade pode acabar gravada com grafias diferentes (ex.: "AZUL"
// vs "Azul Transportes e Turismo LTDA"). Sindicato e diferente: e uma
// relacao (sindicatoId), entao "de"/"para" aqui sao os ids de dois
// Sindicato ja cadastrados (duplicados, ou um errado/um certo) — todo
// motorista do "de" passa pro "para", e o sindicato "de" fica desativado
// (nao apagado, so some das opcoes de filtro/cadastro) pra nao voltar a
// ser escolhido por engano.
export async function mergeDriverFieldValue(
  _prevState: MergeFieldState,
  formData: FormData
): Promise<MergeFieldState> {
  const session = await requireRole("ADMIN", "GESTOR");

  const field = formData.get("field");
  if (typeof field !== "string" || !MERGE_FIELDS.includes(field as MergeField)) {
    return { error: "Campo inválido." };
  }
  const from = normalizeText(formData.get("from"));
  const to = normalizeText(formData.get("to"));
  if (!from || !to) {
    return { error: "Selecione os dois valores (de / para)." };
  }
  if (from === to) {
    return { error: "Os dois valores já são iguais." };
  }

  if (field === "sindicato") {
    const [fromSindicato, toSindicato] = await Promise.all([
      prisma.sindicato.findFirst({ where: { id: from, companyId: session.companyId } }),
      prisma.sindicato.findFirst({ where: { id: to, companyId: session.companyId } }),
    ]);
    if (!fromSindicato || !toSindicato) {
      return { error: "Sindicato não encontrado." };
    }
    const [{ count }] = await prisma.$transaction([
      prisma.driver.updateMany({
        where: { companyId: session.companyId, sindicatoId: from },
        data: { sindicatoId: to },
      }),
      prisma.sindicato.update({ where: { id: from }, data: { active: false } }),
    ]);
    revalidatePath("/cadastros/motoristas");
    revalidatePath("/dashboard");
    return { result: { updated: count } };
  }

  const textField = field as (typeof MERGE_TEXT_FIELDS)[number];
  const result = await prisma.driver.updateMany({
    where: { companyId: session.companyId, [textField]: from },
    data: { [textField]: to },
  });

  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
  return { result: { updated: result.count } };
}

export type TiqueTaqueSyncResult = { updated: number; unchanged: number; notFound: number };
export type TiqueTaqueSyncState = { error?: string; result?: TiqueTaqueSyncResult };

// Ao contrario da importacao acima (que so cria motoristas novos, nunca
// sobrescreve um existente), esta acao atualiza deliberadamente
// empregador/departamento/status dos motoristas JA cadastrados, casando por
// CPF — pedido explicito do usuario pra manter esses 3 campos em dia com
// desligamentos e mudancas de empregador/departamento no TiqueTaque, sem
// precisar reimportar. Motoristas sem correspondencia por CPF (cadastrados
// manualmente, ou CPF desatualizado) ficam intocados e contam em `notFound`.
export async function syncDriversFromTiqueTaque(): Promise<TiqueTaqueSyncState> {
  const session = await requireRole("ADMIN", "GESTOR");

  let employees;
  let paymentSources;
  try {
    [employees, paymentSources] = await Promise.all([fetchAllEmployees(), fetchPaymentSources()]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao buscar funcionários do TiqueTaque." };
  }

  const employeeByCpf = new Map(employees.map((e) => [e.cpf.replace(/\D/g, ""), e]));

  const drivers = await prisma.driver.findMany({
    where: { companyId: session.companyId },
    select: { id: true, cpf: true, active: true, empregador: true, departamento: true, funcao: true },
  });

  let updated = 0;
  let unchanged = 0;
  let notFound = 0;
  const writes: Promise<unknown>[] = [];

  for (const driver of drivers) {
    const emp = employeeByCpf.get(driver.cpf.replace(/\D/g, ""));
    if (!emp) {
      notFound++;
      continue;
    }
    const empregador = emp.paymentSourceId ? paymentSources.get(emp.paymentSourceId) ?? null : null;
    const departamento = emp.department;
    const funcao = emp.jobRole || null;
    const active = !emp.dismissed;

    if (
      driver.empregador === empregador &&
      driver.departamento === departamento &&
      driver.funcao === funcao &&
      driver.active === active
    ) {
      unchanged++;
      continue;
    }
    updated++;
    writes.push(
      prisma.driver.update({ where: { id: driver.id }, data: { empregador, departamento, funcao, active } })
    );
  }

  await Promise.all(writes);

  revalidatePath("/cadastros/motoristas");
  revalidatePath("/dashboard");
  return { result: { updated, unchanged, notFound } };
}
