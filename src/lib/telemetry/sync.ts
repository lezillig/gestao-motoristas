import { prisma } from "@/lib/prisma";
import { normalizePlate } from "@/lib/plate";
import { getActiveTelemetryProvider } from "./index";
import type { TelemetryReadingInput, TelemetryUnmatchedDevice } from "./types";

export type TelemetrySyncResult = {
  provider: string;
  // false quando o fornecedor ativo e o simulado — a tela precisa disso pra
  // rotular a origem das leituras sem chutar pelo nome.
  real: boolean;
  veiculosConsultados: number;
  leiturasRecebidas: number;
  criadas: number;
  // Leitura que o fornecedor devolveu de novo com o MESMO instante ja
  // gravado (veiculo parado, posicao nao mudou desde a ultima
  // sincronizacao). Nao e erro nem duplicata gravada — e o caso normal de
  // sincronizar mais vezes do que o veiculo se move.
  jaExistentes: number;
  // Vinculos veiculo <-> dispositivo gravados nesta rodada (casou por placa
  // pela primeira vez).
  vinculosCriados: number;
  semVinculo: TelemetryUnmatchedDevice[];
};

// Nucleo da sincronizacao de telemetria, sem checagem de sessao/autorizacao
// — quem chama (Server Action autenticada por role, ou rota de cron
// autenticada por secret) e responsavel por verificar permissao antes.
// Mesmo desenho de importDriverDaysCore (src/lib/tiquetaque/importCore.ts).
export async function syncTelemetryCore(
  companyId: string,
  deadline?: number
): Promise<TelemetrySyncResult> {
  const provider = getActiveTelemetryProvider(deadline);

  // Busca inclusive os INATIVO, mas so manda os ativos pro fornecedor: os
  // inativos servem so pra rotular direito o rastreador que sobrou (ver
  // rotularInativos abaixo) — veiculo baixado nao deve gerar leitura nova.
  const todos = await prisma.vehicle.findMany({
    where: { companyId },
    select: { id: true, plate: true, cobliDeviceId: true, status: true },
  });
  const vehicles = todos.filter((v) => v.status !== "INATIVO");
  const placasInativas = new Set(
    todos.filter((v) => v.status === "INATIVO").map((v) => normalizePlate(v.plate))
  );

  const base = {
    provider: provider.name,
    real: provider.real,
    veiculosConsultados: vehicles.length,
    leiturasRecebidas: 0,
    criadas: 0,
    jaExistentes: 0,
    vinculosCriados: 0,
    semVinculo: [] as TelemetryUnmatchedDevice[],
  };
  if (vehicles.length === 0) return base;

  const { readings, unmatched } = await provider.fetchReadings(vehicles);
  base.leiturasRecebidas = readings.length;
  base.semVinculo = rotularInativos(unmatched, placasInativas);
  if (readings.length === 0) return base;

  // Um veiculo pode aparecer mais de uma vez numa rodada quando a frota tem
  // dois rastreadores na mesma placa (troca de equipamento em que o antigo
  // ainda nao foi baixado do painel, caso real em frota). Fica a leitura
  // mais recente — nunca as duas, que virariam duas posicoes conflitantes
  // pro mesmo veiculo no mesmo instante.
  const maisRecentePorVeiculo = new Map<string, TelemetryReadingInput>();
  for (const reading of readings) {
    const atual = maisRecentePorVeiculo.get(reading.vehicleId);
    if (!atual || reading.recordedAt > atual.recordedAt) {
      maisRecentePorVeiculo.set(reading.vehicleId, reading);
    }
  }
  const novas = [...maisRecentePorVeiculo.values()];

  // A Cobli devolve a ULTIMA posicao conhecida, nao um fluxo de novidades:
  // sincronizar de hora em hora um veiculo que passou o dia na garagem traz
  // sempre o mesmo instante. Sem esta checagem, a tabela encheria de copias
  // da mesma leitura (e o ranking de excessos contaria o mesmo excesso
  // varias vezes).
  const desde = new Date(Math.min(...novas.map((r) => r.recordedAt.getTime())));
  const existentes = await prisma.telemetryReading.findMany({
    where: {
      companyId,
      vehicleId: { in: novas.map((r) => r.vehicleId) },
      recordedAt: { gte: desde },
    },
    select: { vehicleId: true, recordedAt: true },
  });
  const jaGravadas = new Set(existentes.map((r) => `${r.vehicleId}|${r.recordedAt.getTime()}`));

  const inserir = novas.filter((r) => !jaGravadas.has(`${r.vehicleId}|${r.recordedAt.getTime()}`));
  base.jaExistentes = novas.length - inserir.length;

  if (inserir.length > 0) {
    const created = await prisma.telemetryReading.createMany({
      data: inserir.map((r) => ({
        companyId,
        vehicleId: r.vehicleId,
        speedKmh: r.speedKmh,
        latitude: r.latitude,
        longitude: r.longitude,
        recordedAt: r.recordedAt,
        provider: provider.name,
      })),
    });
    base.criadas = created.count;
  }

  base.vinculosCriados = await gravarVinculos(vehicles, novas);
  return base;
}

// O fornecedor so recebe os veiculos ativos, entao pra ele um rastreador na
// placa de um veiculo INATIVO e indistinguivel de um rastreador em placa
// desconhecida. Aqui, que temos o cadastro inteiro, o motivo e corrigido —
// e a diferenca entre "cadastre este veiculo" e "este veiculo foi baixado,
// tire o rastreador dele no painel da Cobli".
function rotularInativos(
  unmatched: TelemetryUnmatchedDevice[],
  placasInativas: Set<string>
): TelemetryUnmatchedDevice[] {
  return unmatched.map((device) =>
    device.reason === "sem_veiculo_no_cadastro" && device.plate && placasInativas.has(device.plate)
      ? { ...device, reason: "veiculo_inativo" as const }
      : device
  );
}

// Grava Vehicle.cobliDeviceId pros veiculos que casaram por placa e ainda
// nao tinham vinculo. Deixa em paz quem ja tem um id gravado (mesmo que
// diferente): trocar o vinculo automaticamente esconderia uma troca de
// rastreador que alguem precisa conferir. Falha de vinculo (ex. o mesmo
// deviceId ja pertencer a outro veiculo, o que o indice unico barra) e
// engolida de proposito — a leitura ja foi gravada, o vinculo e so
// otimizacao das proximas rodadas.
async function gravarVinculos(
  vehicles: { id: string; cobliDeviceId: string | null }[],
  readings: TelemetryReadingInput[]
): Promise<number> {
  const semVinculo = new Set(vehicles.filter((v) => !v.cobliDeviceId).map((v) => v.id));
  let gravados = 0;
  for (const reading of readings) {
    if (!reading.externalDeviceId || !semVinculo.has(reading.vehicleId)) continue;
    try {
      await prisma.vehicle.update({
        where: { id: reading.vehicleId },
        data: { cobliDeviceId: reading.externalDeviceId },
      });
      gravados++;
    } catch {
      // indice unico ja ocupado por outro veiculo — ignora, ver comentario acima
    }
  }
  return gravados;
}
