"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { fetchAllEmployees } from "@/lib/tiquetaque/client";
import { signTiqueTaquePlanItem, verifyTiqueTaquePlanItem } from "@/lib/tiquetaque/planToken";
import { importDriverDaysCore } from "@/lib/tiquetaque/importCore";
import type { TiqueTaqueDriverImportResult } from "@/lib/tiquetaque/importCore";
import { hashPontoState } from "@/lib/integrity";

export type { TiqueTaqueImportRowError, TiqueTaqueDriverImportResult } from "@/lib/tiquetaque/importCore";

export type PontoFormState = { error?: string };

const schema = z.object({
  driverId: z.string().min(1, "Selecione o motorista"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .transform(parseLocalDate),
  clockIn: z.string().regex(/^\d{2}:\d{2}$/, "Horário de entrada inválido"),
  clockOut: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Horário de saída inválido")
    .optional(),
  intervaloInicio: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Horário de início do intervalo inválido")
    .optional(),
  intervaloFim: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Horário de fim do intervalo inválido")
    .optional(),
  esperaInicio: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Horário de início do tempo de espera inválido")
    .optional(),
  esperaFim: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Horário de fim do tempo de espera inválido")
    .optional(),
  notes: z.string().max(2000, "Observação muito longa (máx. 2000 caracteres)").optional(),
});

function parseForm(formData: FormData) {
  return schema.safeParse({
    driverId: formData.get("driverId"),
    date: formData.get("date"),
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut") || undefined,
    intervaloInicio: formData.get("intervaloInicio") || undefined,
    intervaloFim: formData.get("intervaloFim") || undefined,
    esperaInicio: formData.get("esperaInicio") || undefined,
    esperaFim: formData.get("esperaFim") || undefined,
    notes: formData.get("notes") || undefined,
  });
}

async function assertNoDuplicate(
  companyId: string,
  driverId: string,
  date: Date,
  excludeId?: string
) {
  const existing = await prisma.timeClockEntry.findFirst({
    where: {
      companyId,
      driverId,
      date,
      id: excludeId ? { not: excludeId } : undefined,
    },
  });
  return existing !== null;
}

async function assertDriverOwnership(companyId: string, driverId: string): Promise<boolean> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId, companyId } });
  return driver !== null;
}

export async function createEntry(
  _prevState: PontoFormState,
  formData: FormData
): Promise<PontoFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  if (!(await assertDriverOwnership(session.companyId, parsed.data.driverId))) {
    return { error: "Motorista não encontrado." };
  }

  const duplicate = await assertNoDuplicate(session.companyId, parsed.data.driverId, parsed.data.date);
  if (duplicate) {
    return { error: "Já existe um registro de ponto para este motorista nesta data. Edite o registro existente." };
  }

  const clockOut = parsed.data.clockOut || null;
  const intervaloInicio = parsed.data.intervaloInicio || null;
  const intervaloFim = parsed.data.intervaloFim || null;
  const esperaInicio = parsed.data.esperaInicio || null;
  const esperaFim = parsed.data.esperaFim || null;
  const hashAtual = hashPontoState({
    clockIn: parsed.data.clockIn,
    clockOut,
    intervaloInicio,
    intervaloFim,
    esperaInicio,
    esperaFim,
    punches: null,
  });

  await prisma.timeClockEntry.create({
    data: {
      ...parsed.data,
      clockOut,
      intervaloInicio,
      intervaloFim,
      esperaInicio,
      esperaFim,
      companyId: session.companyId,
      hashAtual,
    },
  });

  revalidatePath("/ponto");
  redirect("/ponto");
}

export async function updateEntry(
  id: string,
  _prevState: PontoFormState,
  formData: FormData
): Promise<PontoFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  if (!(await assertDriverOwnership(session.companyId, parsed.data.driverId))) {
    return { error: "Motorista não encontrado." };
  }

  const duplicate = await assertNoDuplicate(session.companyId, parsed.data.driverId, parsed.data.date, id);
  if (duplicate) {
    return { error: "Já existe um registro de ponto para este motorista nesta data. Edite o registro existente." };
  }

  const existing = await prisma.timeClockEntry.findUnique({ where: { id, companyId: session.companyId } });
  if (!existing) {
    return { error: "Registro não encontrado." };
  }

  const clockOut = parsed.data.clockOut || null;
  const intervaloInicio = parsed.data.intervaloInicio || null;
  const intervaloFim = parsed.data.intervaloFim || null;
  const esperaInicio = parsed.data.esperaInicio || null;
  const esperaFim = parsed.data.esperaFim || null;

  // Edicao manual: se o conteudo realmente mudou, registra a alteracao em
  // TimeClockCorrection (origem EDICAO_MANUAL, com o usuario que fez e o
  // hash antes/depois) — mesma trilha de auditoria ja usada pra correcoes
  // vindas do TiqueTaque, agora tambem cobrindo edicao feita direto aqui no
  // app (antes desta mudanca, uma edicao manual nao deixava rastro nenhum).
  const stateAntes = {
    clockIn: existing.clockIn,
    clockOut: existing.clockOut,
    intervaloInicio: existing.intervaloInicio,
    intervaloFim: existing.intervaloFim,
    esperaInicio: existing.esperaInicio,
    esperaFim: existing.esperaFim,
    punches: existing.punches,
  };
  const stateDepois = {
    clockIn: parsed.data.clockIn,
    clockOut,
    intervaloInicio,
    intervaloFim,
    esperaInicio,
    esperaFim,
    punches: existing.punches,
  };
  const changed =
    stateAntes.clockIn !== stateDepois.clockIn ||
    stateAntes.clockOut !== stateDepois.clockOut ||
    stateAntes.intervaloInicio !== stateDepois.intervaloInicio ||
    stateAntes.intervaloFim !== stateDepois.intervaloFim ||
    stateAntes.esperaInicio !== stateDepois.esperaInicio ||
    stateAntes.esperaFim !== stateDepois.esperaFim;

  const hashAntes = existing.hashAtual ?? hashPontoState(stateAntes);
  const hashDepois = hashPontoState(stateDepois);

  await prisma.$transaction([
    prisma.timeClockEntry.update({
      where: { id, companyId: session.companyId },
      data: {
        ...parsed.data,
        clockOut,
        intervaloInicio,
        intervaloFim,
        esperaInicio,
        esperaFim,
        hashAtual: hashDepois,
      },
    }),
    ...(changed
      ? [
          prisma.timeClockCorrection.create({
            data: {
              companyId: session.companyId,
              driverId: existing.driverId,
              entryId: existing.id,
              date: existing.date,
              origem: "EDICAO_MANUAL",
              editadoPorUserId: session.userId,
              clockInAntes: stateAntes.clockIn,
              clockOutAntes: stateAntes.clockOut,
              intervaloInicioAntes: stateAntes.intervaloInicio,
              intervaloFimAntes: stateAntes.intervaloFim,
              punchesAntes: existing.punches ?? undefined,
              clockInDepois: stateDepois.clockIn,
              clockOutDepois: stateDepois.clockOut,
              intervaloInicioDepois: stateDepois.intervaloInicio,
              intervaloFimDepois: stateDepois.intervaloFim,
              punchesDepois: existing.punches ?? undefined,
              hashAntes,
              hashDepois,
            },
          }),
        ]
      : []),
  ]);

  revalidatePath("/ponto");
  redirect("/ponto");
}

export async function deleteEntry(id: string) {
  const session = await requireRole("ADMIN", "GESTOR");

  const existing = await prisma.timeClockEntry.findUnique({ where: { id, companyId: session.companyId } });
  if (!existing) {
    redirect("/ponto");
  }

  const stateAntes = {
    clockIn: existing.clockIn,
    clockOut: existing.clockOut,
    intervaloInicio: existing.intervaloInicio,
    intervaloFim: existing.intervaloFim,
    esperaInicio: existing.esperaInicio,
    esperaFim: existing.esperaFim,
    punches: existing.punches,
  };
  const hashAntes = existing.hashAtual ?? hashPontoState(stateAntes);

  // Registra a exclusao ANTES de apagar (origem EXCLUSAO_MANUAL, so "antes"
  // preenchido, "depois" vazio) — a linha de auditoria sobrevive ao
  // registro apagado porque `entryId` em TimeClockCorrection e
  // `onDelete: SetNull`, nao Cascade: apagar o turno nao pode apagar o
  // proprio historico de ter sido apagado.
  await prisma.$transaction([
    prisma.timeClockCorrection.create({
      data: {
        companyId: session.companyId,
        driverId: existing.driverId,
        entryId: existing.id,
        date: existing.date,
        origem: "EXCLUSAO_MANUAL",
        editadoPorUserId: session.userId,
        clockInAntes: stateAntes.clockIn,
        clockOutAntes: stateAntes.clockOut,
        intervaloInicioAntes: stateAntes.intervaloInicio,
        intervaloFimAntes: stateAntes.intervaloFim,
        punchesAntes: existing.punches ?? undefined,
        hashAntes,
        hashDepois: null,
      },
    }),
    prisma.timeClockEntry.delete({ where: { id, companyId: session.companyId } }),
  ]);

  revalidatePath("/ponto");
  redirect("/ponto");
}

// `token` amarra o employeeId ao driverId+empresa (ver planToken.ts) — a
// fase 2 recebe o employeeId de volta do cliente e PRECISA revalidar esse
// vinculo antes de usá-lo, não pode confiar nele cegamente.
export type TiqueTaquePlanItem = { driverId: string; driverName: string; employeeId: string | null; token: string | null };
export type TiqueTaquePlanResult = { error?: string; plan?: TiqueTaquePlanItem[] };

const tiqueTaqueRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inicial inválida"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data final inválida"),
});

// Fase 1 (rapida): busca a lista de funcionarios do TiqueTaque UMA vez e casa
// por CPF com os motoristas ativos da empresa, devolvendo um plano — nao
// busca batidas ainda. O cliente chama importDriverFromTiqueTaque uma vez por
// item do plano, cada chamada curta o bastante pra nao estourar o timeout de
// funcao serverless que uma importacao monolitica (todos os motoristas numa
// so chamada) acabava batendo em producao com periodos longos.
export async function prepareTiqueTaqueImport(
  startDate: string,
  endDate: string
): Promise<TiqueTaquePlanResult> {
  const session = await requireRole("ADMIN", "GESTOR");

  const parsed = tiqueTaqueRangeSchema.safeParse({ startDate, endDate });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datas inválidas" };
  }
  if (parsed.data.startDate > parsed.data.endDate) {
    return { error: "A data inicial deve ser anterior à data final." };
  }

  let employees;
  try {
    employees = await fetchAllEmployees();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao buscar funcionários do TiqueTaque." };
  }
  const employeeByCpf = new Map(employees.map((e) => [e.cpf.replace(/\D/g, ""), e]));

  const drivers = await prisma.driver.findMany({
    where: { companyId: session.companyId, active: true },
    select: { id: true, name: true, cpf: true },
  });

  const plan: TiqueTaquePlanItem[] = drivers.map((driver) => {
    const employeeId = employeeByCpf.get(driver.cpf.replace(/\D/g, ""))?.id ?? null;
    return {
      driverId: driver.id,
      driverName: driver.name,
      employeeId,
      token: employeeId ? signTiqueTaquePlanItem(session.companyId, driver.id, employeeId) : null,
    };
  });

  return { plan };
}

// Fase 2: uma chamada curta por motorista (busca so as batidas DELE no
// periodo e cria os registros) — nunca sobrescreve um registro ja existente
// de nenhuma origem.
export async function importDriverFromTiqueTaque(
  driverId: string,
  employeeId: string,
  token: string,
  startDate: string,
  endDate: string
): Promise<TiqueTaqueDriverImportResult> {
  const session = await requireRole("ADMIN", "GESTOR");

  const driver = await prisma.driver.findUnique({ where: { id: driverId, companyId: session.companyId } });
  if (!driver) {
    return { created: 0, corrected: 0, errors: [{ driverName: "—", message: "Motorista não encontrado." }] };
  }

  if (!verifyTiqueTaquePlanItem(session.companyId, driverId, employeeId, token)) {
    return {
      created: 0,
      corrected: 0,
      errors: [{ driverName: driver.name, message: "Vínculo com o TiqueTaque inválido — refaça a importação." }],
    };
  }

  const result = await importDriverDaysCore(session.companyId, driver.id, driver.name, employeeId, startDate, endDate);

  revalidatePath("/ponto");
  revalidatePath("/ponto/analise");
  revalidatePath("/ponto/correcoes");
  return result;
}
