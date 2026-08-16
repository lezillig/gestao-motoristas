"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import { fetchAllEmployees, fetchEmployeeDays } from "@/lib/tiquetaque/client";
import { signTiqueTaquePlanItem, verifyTiqueTaquePlanItem } from "@/lib/tiquetaque/planToken";

export type PontoFormState = { error?: string };

// Chave canonica pra comparar `punches` — nao dá pra usar JSON.stringify
// direto: o Postgres (jsonb) reordena as chaves de cada objeto ao salvar,
// entao um valor recem-lido do banco quase nunca bate byte-a-byte com o
// mesmo valor recem-computado, mesmo quando o conteudo e identico (bug real
// encontrado ao reimportar o mesmo periodo duas vezes e ver correcoes
// fantasma serem criadas).
function punchesKey(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((p) => {
      if (typeof p !== "object" || p === null) return "";
      const { entrada, saida } = p as { entrada?: unknown; saida?: unknown };
      return `${entrada ?? ""}|${saida ?? ""}`;
    })
    .join(",");
}

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

  await prisma.timeClockEntry.create({
    data: {
      ...parsed.data,
      clockOut: parsed.data.clockOut || null,
      intervaloInicio: parsed.data.intervaloInicio || null,
      intervaloFim: parsed.data.intervaloFim || null,
      esperaInicio: parsed.data.esperaInicio || null,
      esperaFim: parsed.data.esperaFim || null,
      companyId: session.companyId,
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

  await prisma.timeClockEntry.update({
    where: { id, companyId: session.companyId },
    data: {
      ...parsed.data,
      clockOut: parsed.data.clockOut || null,
      intervaloInicio: parsed.data.intervaloInicio || null,
      intervaloFim: parsed.data.intervaloFim || null,
      esperaInicio: parsed.data.esperaInicio || null,
      esperaFim: parsed.data.esperaFim || null,
    },
  });

  revalidatePath("/ponto");
  redirect("/ponto");
}

export async function deleteEntry(id: string) {
  const session = await requireRole("ADMIN", "GESTOR");
  await prisma.timeClockEntry.delete({ where: { id, companyId: session.companyId } });
  revalidatePath("/ponto");
  redirect("/ponto");
}

export type TiqueTaqueImportRowError = { driverName: string; date?: string; message: string };
export type TiqueTaqueDriverImportResult = {
  created: number;
  corrected: number;
  errors: TiqueTaqueImportRowError[];
};
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

  let days;
  try {
    days = await fetchEmployeeDays(employeeId, startDate, endDate);
  } catch (e) {
    return {
      created: 0,
      corrected: 0,
      errors: [{ driverName: driver.name, message: e instanceof Error ? e.message : "Falha ao buscar batidas do TiqueTaque." }],
    };
  }

  const existingEntries = await prisma.timeClockEntry.findMany({
    where: {
      companyId: session.companyId,
      driverId,
      date: { gte: parseLocalDate(startDate), lte: parseLocalDate(endDate) },
    },
  });
  const existingByDate = new Map(existingEntries.map((e) => [format(e.date, "yyyy-MM-dd"), e]));

  const errors: TiqueTaqueImportRowError[] = [];
  let created = 0;
  let corrected = 0;

  for (const day of days) {
    const existing = existingByDate.get(day.date);

    if (!existing) {
      await prisma.timeClockEntry.create({
        data: {
          companyId: session.companyId,
          driverId: driver.id,
          date: parseLocalDate(day.date),
          clockIn: day.clockIn,
          clockOut: day.clockOut,
          intervaloInicio: day.intervaloInicio,
          intervaloFim: day.intervaloFim,
          punches: day.pairs,
          fonte: "TIQUETAQUE",
        },
      });
      created++;
      continue;
    }

    if (existing.fonte !== "TIQUETAQUE") {
      errors.push({ driverName: driver.name, date: day.date, message: "Já existe registro de ponto nesta data — não sobrescrito." });
      continue;
    }

    // Registro ja veio do TiqueTaque antes: se os horarios ou os pares
    // entrada/saida vieram diferentes desta vez, e porque a correcao foi
    // feita direto no TiqueTaque — atualiza e guarda o antes/depois em
    // TimeClockCorrection (nunca sobrescreve sem deixar rastro), em vez de
    // reportar como conflito. Compara `punches` tambem (nao so os 4 campos
    // planos) porque uma correcao dentro de uma pausa do meio do dia pode
    // nao mudar o primeiro horario nem o ultimo.
    const changed =
      existing.clockIn !== day.clockIn ||
      existing.clockOut !== day.clockOut ||
      existing.intervaloInicio !== day.intervaloInicio ||
      existing.intervaloFim !== day.intervaloFim ||
      punchesKey(existing.punches) !== punchesKey(day.pairs);
    if (!changed) continue;

    await prisma.$transaction([
      prisma.timeClockEntry.update({
        where: { id: existing.id },
        data: {
          clockIn: day.clockIn,
          clockOut: day.clockOut,
          intervaloInicio: day.intervaloInicio,
          intervaloFim: day.intervaloFim,
          punches: day.pairs,
        },
      }),
      prisma.timeClockCorrection.create({
        data: {
          companyId: session.companyId,
          driverId: driver.id,
          entryId: existing.id,
          date: existing.date,
          clockInAntes: existing.clockIn,
          clockOutAntes: existing.clockOut,
          intervaloInicioAntes: existing.intervaloInicio,
          intervaloFimAntes: existing.intervaloFim,
          punchesAntes: existing.punches ?? undefined,
          clockInDepois: day.clockIn,
          clockOutDepois: day.clockOut,
          intervaloInicioDepois: day.intervaloInicio,
          intervaloFimDepois: day.intervaloFim,
          punchesDepois: day.pairs,
        },
      }),
    ]);
    corrected++;
  }

  revalidatePath("/ponto");
  revalidatePath("/ponto/analise");
  revalidatePath("/ponto/correcoes");
  return { created, corrected, errors };
}
