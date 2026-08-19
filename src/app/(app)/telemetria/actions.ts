"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { getActiveTelemetryProvider } from "@/lib/telemetry";
import { syncTelemetryForCompany } from "@/lib/telemetry/sync";

// redirect() funciona lançando NEXT_REDIRECT, então ele nunca pode ficar
// dentro do try — se ficasse, o catch engoliria o redirecionamento e a ação
// terminaria em erro genérico. Os dois handlers abaixo montam a mensagem no
// try e só redirecionam depois.

export async function syncTelemetry() {
  const session = await requireRole("ADMIN", "GESTOR");

  const params = new URLSearchParams();
  try {
    const result = await syncTelemetryForCompany(session.companyId);
    const partes = [
      `${result.created} leitura(s) nova(s)`,
      `${result.duplicates} já registrada(s)`,
      `${result.speeding} acima do limite`,
    ];
    if (result.unknownPlates.length > 0) {
      partes.push(`placas monitoradas sem cadastro: ${result.unknownPlates.join(", ")}`);
    }
    params.set("ok", `${result.provider}: ${partes.join(" · ")}.`);
  } catch (e) {
    params.set("erro", e instanceof Error ? e.message : "Falha ao sincronizar a telemetria.");
  }

  revalidatePath("/telemetria");
  redirect(`/telemetria?${params.toString()}`);
}

export async function testarConexao() {
  await requireRole("ADMIN", "GESTOR");

  const params = new URLSearchParams();
  const provider = getActiveTelemetryProvider();
  try {
    const status = await provider.checkConnection();
    params.set(status.ok ? "ok" : "erro", status.message);
  } catch (e) {
    params.set("erro", e instanceof Error ? e.message : "Falha ao testar a conexão.");
  }

  redirect(`/telemetria?${params.toString()}`);
}
