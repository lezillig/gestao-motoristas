"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { syncTelemetryCore } from "@/lib/telemetry/sync";

// Sincroniza a telemetria com o fornecedor ativo (Cobli quando ha
// COBLI_API_KEY; simulado caso contrario — ver getActiveTelemetryProvider).
// O resultado volta pela query string porque a acao redireciona: sem isso a
// tela recarregaria sem dizer o que aconteceu, e "nada mudou" e um resultado
// legitimo e frequente aqui (veiculo parado, posicao ja gravada).
export async function sincronizarTelemetria() {
  const session = await requireRole("ADMIN", "GESTOR");

  const params = new URLSearchParams();
  try {
    const result = await syncTelemetryCore(session.companyId);
    params.set("sync", "ok");
    params.set("criadas", String(result.criadas));
    params.set("repetidas", String(result.jaExistentes));
    params.set("vinculos", String(result.vinculosCriados));
    // Contados por motivo: "cadastre este veículo", "este veículo foi
    // baixado" e "o rastreador não reportou posição" pedem providências
    // diferentes de quem lê o resultado.
    params.set("semCadastro", String(result.semVinculo.filter((d) => d.reason === "sem_veiculo_no_cadastro").length));
    params.set("inativos", String(result.semVinculo.filter((d) => d.reason === "veiculo_inativo").length));
    params.set("semPosicao", String(result.semVinculo.filter((d) => d.reason === "sem_posicao").length));
  } catch (e) {
    params.set("sync", "erro");
    params.set("mensagem", e instanceof Error ? e.message : "Falha ao sincronizar a telemetria.");
  }

  revalidatePath("/telemetria");
  redirect(`/telemetria?${params.toString()}`);
}
