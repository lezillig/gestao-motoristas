"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findEscalaConflicts, findInterjornadaWarnings, type InterjornadaWarning } from "@/lib/escalaConflicts";
import { parseLocalDate } from "@/lib/date";

export type EscalaFormValues = {
  driverId: string;
  vehicleId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string;
};
export type EscalaFormState = { error?: string; warning?: string; values?: EscalaFormValues };

// React reseta campos nao controlados do formulario assim que a Server
// Action retorna — sem devolver os valores enviados, o fluxo "salvar mesmo
// assim" do aviso de interjornada reenviaria o formulario vazio no segundo
// clique. Ver EscalaForm.tsx (usa isso pra re-popular via `key`).
function rawValues(formData: FormData): EscalaFormValues {
  return {
    driverId: String(formData.get("driverId") ?? ""),
    vehicleId: String(formData.get("vehicleId") ?? ""),
    date: String(formData.get("date") ?? ""),
    startTime: String(formData.get("startTime") ?? ""),
    endTime: String(formData.get("endTime") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

const schema = z
  .object({
    driverId: z.string().min(1, "Selecione o motorista"),
    vehicleId: z.string().min(1, "Selecione o veículo"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
      .transform(parseLocalDate),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Horário inválido"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "Horário inválido"),
    notes: z.string().optional(),
  })
  .refine((data) => data.startTime < data.endTime, {
    message: "O horário final deve ser depois do horário inicial",
    path: ["endTime"],
  });

function parseForm(formData: FormData) {
  return schema.safeParse({
    driverId: formData.get("driverId"),
    vehicleId: formData.get("vehicleId"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    notes: formData.get("notes") || undefined,
  });
}

function interjornadaWarningMessage(warnings: InterjornadaWarning[]): string {
  const parts = warnings.map((w) => {
    const h = Math.floor(w.gapMinutes / 60);
    const m = w.gapMinutes % 60;
    const minH = Math.floor(w.minRequiredMinutes / 60);
    const label = w.direction === "anterior" ? "turno anterior" : "próximo turno";
    return `${h}h${m > 0 ? `${m}min` : ""} de descanso até o ${label} (${w.adjacentDate.toLocaleDateString("pt-BR")}, ${w.adjacentStartTime}–${w.adjacentEndTime}) — abaixo do mínimo de ${minH}h`;
  });
  return `Atenção: descanso insuficiente (art. 235-C, §4º CLT). ${parts.join("; ")}.`;
}

function conflictMessage(
  conflicts: Awaited<ReturnType<typeof findEscalaConflicts>>
) {
  const parts = conflicts.map((c) =>
    c.type === "motorista"
      ? `motorista já escalado das ${c.startTime} às ${c.endTime} (veículo ${c.vehiclePlate})`
      : `veículo já escalado das ${c.startTime} às ${c.endTime} (motorista ${c.driverName})`
  );
  return `Conflito de horário: ${parts.join("; ")}.`;
}

async function assertDriverAndVehicleOwnership(
  companyId: string,
  driverId: string,
  vehicleId: string
): Promise<string | null> {
  const [driver, vehicle] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId, companyId } }),
    prisma.vehicle.findUnique({ where: { id: vehicleId, companyId } }),
  ]);
  if (!driver) return "Motorista não encontrado.";
  if (!vehicle) return "Veículo não encontrado.";
  return null;
}

export async function createEscala(
  _prevState: EscalaFormState,
  formData: FormData
): Promise<EscalaFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const values = rawValues(formData);
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos", values };
  }

  const ownershipError = await assertDriverAndVehicleOwnership(
    session.companyId,
    parsed.data.driverId,
    parsed.data.vehicleId
  );
  if (ownershipError) return { error: ownershipError, values };

  const conflicts = await findEscalaConflicts({
    companyId: session.companyId,
    ...parsed.data,
  });
  if (conflicts.length > 0) {
    return { error: conflictMessage(conflicts), values };
  }

  if (formData.get("confirmInterjornada") !== "true") {
    const warnings = await findInterjornadaWarnings({ companyId: session.companyId, ...parsed.data });
    if (warnings.length > 0) {
      return { warning: interjornadaWarningMessage(warnings), values };
    }
  }

  await prisma.escala.create({
    data: { ...parsed.data, companyId: session.companyId },
  });

  revalidatePath("/escalas");
  redirect("/escalas");
}

export async function updateEscala(
  id: string,
  _prevState: EscalaFormState,
  formData: FormData
): Promise<EscalaFormState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const values = rawValues(formData);
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos", values };
  }

  const ownershipError = await assertDriverAndVehicleOwnership(
    session.companyId,
    parsed.data.driverId,
    parsed.data.vehicleId
  );
  if (ownershipError) return { error: ownershipError, values };

  const conflicts = await findEscalaConflicts({
    companyId: session.companyId,
    ...parsed.data,
    excludeId: id,
  });
  if (conflicts.length > 0) {
    return { error: conflictMessage(conflicts), values };
  }

  if (formData.get("confirmInterjornada") !== "true") {
    const warnings = await findInterjornadaWarnings({ companyId: session.companyId, ...parsed.data, excludeId: id });
    if (warnings.length > 0) {
      return { warning: interjornadaWarningMessage(warnings), values };
    }
  }

  await prisma.escala.update({
    where: { id, companyId: session.companyId },
    data: parsed.data,
  });

  revalidatePath("/escalas");
  redirect("/escalas");
}

export async function deleteEscala(id: string) {
  const session = await requireRole("ADMIN", "GESTOR");
  await prisma.escala.delete({ where: { id, companyId: session.companyId } });
  revalidatePath("/escalas");
  redirect("/escalas");
}
