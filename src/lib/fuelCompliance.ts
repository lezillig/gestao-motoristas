import type { FuelTransaction, Vehicle, Driver, AnpPrecoReferencia } from "@prisma/client";
import { normalizeProduto } from "@/lib/anp/client";

// Padrao "computado, nao persistido" (mesmo estilo de pontoCompliance.ts,
// speedCompliance.ts, maintenance.ts): estas funcoes so leem transacoes ja
// importadas, nada e gravado aqui.

// Eixo A (Boas Praticas de gestao de combustivel): cadastro incompleto —
// placa/motorista da planilha nao bateu com nenhum Vehicle/Driver cadastrado.
export function findUnlinkedTransactions(txs: FuelTransaction[]) {
  return {
    semVeiculo: txs.filter((t) => !t.vehicleId),
    semMotorista: txs.filter((t) => !t.driverId),
  };
}

// Eixo B: transacao vinculada a um veiculo ou motorista que HOJE esta
// inativo. Limitacao real (nao ha historico de status por data, so o
// estado atual): uma transacao antiga de um motorista que so foi desligado
// depois tambem aparece aqui — mesma limitacao ja aceita em /utilizacao
// pra divergencia escala x uso real.
export function findInactiveLinkTransactions(
  txs: FuelTransaction[],
  vehicles: Vehicle[],
  drivers: Driver[]
) {
  const inactiveVehicleIds = new Set(vehicles.filter((v) => v.status !== "ATIVO").map((v) => v.id));
  const inactiveDriverIds = new Set(drivers.filter((d) => !d.active).map((d) => d.id));
  return txs.filter(
    (t) =>
      (t.vehicleId && inactiveVehicleIds.has(t.vehicleId)) ||
      (t.driverId && inactiveDriverIds.has(t.driverId))
  );
}

const DUPLICATE_VALUE_TOLERANCE_CENTS = 2;

// Eixo D: mesmo veiculo, mesmo dia, valor quase identico — mesma tolerancia
// de centavos citada no manual tecnico da Ticket Log (Recolha Autonoma) pra
// casar transacoes.
export function findSuspectedDuplicates(txs: FuelTransaction[]): FuelTransaction[] {
  const byVehicle = new Map<string, FuelTransaction[]>();
  for (const t of txs) {
    if (!t.vehicleId) continue;
    const list = byVehicle.get(t.vehicleId) ?? [];
    list.push(t);
    byVehicle.set(t.vehicleId, list);
  }

  const duplicates = new Set<string>();
  for (const list of byVehicle.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const sameDay =
          a.dataHora.getFullYear() === b.dataHora.getFullYear() &&
          a.dataHora.getMonth() === b.dataHora.getMonth() &&
          a.dataHora.getDate() === b.dataHora.getDate();
        if (sameDay && Math.abs(a.valorCents - b.valorCents) <= DUPLICATE_VALUE_TOLERANCE_CENTS) {
          duplicates.add(a.id);
          duplicates.add(b.id);
        }
      }
    }
  }
  return txs.filter((t) => duplicates.has(t.id));
}

// Eixo C: hodometro informado menor que o da transacao anterior do mesmo
// veiculo (ou menor que o hodometro atual do cadastro do veiculo).
export function findOdometerRegressions(
  txs: FuelTransaction[],
  vehicles: Vehicle[]
): FuelTransaction[] {
  const currentMileageById = new Map(vehicles.map((v) => [v.id, v.currentMileage]));
  const byVehicle = new Map<string, FuelTransaction[]>();
  for (const t of txs) {
    if (!t.vehicleId || t.hodometro == null) continue;
    const list = byVehicle.get(t.vehicleId) ?? [];
    list.push(t);
    byVehicle.set(t.vehicleId, list);
  }

  const regressions = new Set<string>();
  for (const [vehicleId, list] of byVehicle) {
    const sorted = [...list].sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime());
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i].hodometro as number) < (sorted[i - 1].hodometro as number)) {
        regressions.add(sorted[i].id);
      }
    }
    const current = currentMileageById.get(vehicleId);
    if (current && sorted.length > 0) {
      const last = sorted[sorted.length - 1];
      if ((last.hodometro as number) < current) regressions.add(last.id);
    }
  }
  return txs.filter((t) => regressions.has(t.id));
}

// Eixo E: custo total e gasto por veiculo (R$, em centavos) — usado pro
// ranking "veiculos com maior gasto".
export function totalSpentCents(txs: FuelTransaction[]): number {
  return txs.reduce((sum, t) => sum + t.valorCents, 0);
}

export function averagePriceCentsPerLiter(txs: FuelTransaction[]): number | null {
  const totalLiters = txs.reduce((sum, t) => sum + t.volumeLitros, 0);
  if (totalLiters <= 0) return null;
  return totalSpentCents(txs) / totalLiters;
}

export function spentByVehicle(txs: FuelTransaction[], vehicles: Vehicle[]) {
  const plateById = new Map(vehicles.map((v) => [v.id, v.plate]));
  const totals = new Map<string, number>();
  for (const t of txs) {
    if (!t.vehicleId) continue;
    totals.set(t.vehicleId, (totals.get(t.vehicleId) ?? 0) + t.valorCents);
  }
  return [...totals.entries()]
    .map(([vehicleId, cents]) => ({ vehicleId, plate: plateById.get(vehicleId) ?? "?", cents }))
    .sort((a, b) => b.cents - a.cents);
}

const OVERPRICE_THRESHOLD = 0.1; // 10% acima da media ANP da mesma UF/produto/semana

export type OverpricedTransaction = {
  id: string;
  paidPriceCents: number;
  refPriceCents: number;
  deltaPercent: number;
};

// Eixo E: compara o preco pago por litro contra a media de revenda da ANP
// pra mesma UF + produto + semana (src/lib/anp/client.ts). So compara
// transacoes com UF preenchido e cujo texto de "combustivel" e reconhecido
// por normalizeProduto — sem essas duas informacoes, a transacao fica de
// fora (nao e possivel comparar, nao e um "OK" nem um alerta). Informativo,
// nao e acusacao de fraude — mesmo tom ja usado em jurisprudencia.ts.
export function findOverpricedTransactions(
  txs: FuelTransaction[],
  refPrices: AnpPrecoReferencia[]
): OverpricedTransaction[] {
  const results: OverpricedTransaction[] = [];
  for (const t of txs) {
    if (!t.uf || !t.combustivel || t.volumeLitros <= 0) continue;
    const produto = normalizeProduto(t.combustivel);
    if (!produto) continue;

    const ref = refPrices.find(
      (r) =>
        r.uf === t.uf &&
        r.produto === produto &&
        t.dataHora >= r.semanaInicio &&
        t.dataHora <= r.semanaFim
    );
    if (!ref) continue;

    const paidPriceCents = t.valorCents / t.volumeLitros;
    if (paidPriceCents > ref.precoMedioCents * (1 + OVERPRICE_THRESHOLD)) {
      results.push({
        id: t.id,
        paidPriceCents,
        refPriceCents: ref.precoMedioCents,
        deltaPercent: ((paidPriceCents - ref.precoMedioCents) / ref.precoMedioCents) * 100,
      });
    }
  }
  return results;
}
