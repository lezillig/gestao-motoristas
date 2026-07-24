import Link from "next/link";
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Fuel, Gauge, Link2Off, TriangleAlert, Trophy } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, primaryButtonClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import {
  findUnlinkedTransactions,
  findInactiveLinkTransactions,
  findSuspectedDuplicates,
  findOdometerRegressions,
  findOverpricedTransactions,
  totalSpentCents,
  averagePriceCentsPerLiter,
  spentByVehicle,
} from "@/lib/fuelCompliance";
import { anpWeekRange } from "@/lib/anp/client";
import { syncAnpPrices } from "./actions";

const SORT_FIELDS = [
  "dataHora",
  "placa",
  "motorista",
  "modelo",
  "valor",
  "litros",
  "combustivel",
  "hodometro",
  "kmPorLitro",
  "posto",
] as const;
type SortField = (typeof SORT_FIELDS)[number];

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const SITUACAO_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "sem_veiculo", label: "Sem veículo" },
  { value: "sem_motorista", label: "Sem motorista" },
  { value: "inativo", label: "Vínculo inativo" },
  { value: "duplicata", label: "Duplicata suspeita" },
  { value: "hodometro", label: "Hodômetro retrocedido" },
  { value: "anp", label: "Acima do ANP" },
  { value: "ok", label: "OK" },
] as const;

export default async function CombustivelPage({
  searchParams,
}: {
  searchParams: Promise<{
    mes?: string;
    sort?: string;
    dir?: string;
    placa?: string;
    motorista?: string;
    modelo?: string;
    combustivel?: string;
    posto?: string;
    situacao?: string;
  }>;
}) {
  const session = await requireSession();
  const { mes, sort, dir, placa, motorista, modelo, combustivel, posto, situacao } = await searchParams;

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);
  const monthEnd = addDays(endOfMonth(anchor), 1); // exclusivo
  const prevMonth = format(subMonths(monthStart, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthStart, 1), "yyyy-MM");

  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "dataHora";
  const sortDir = dir === "asc" ? "asc" : "desc";

  const [txs, vehicles, drivers, refPrices] = await Promise.all([
    prisma.fuelTransaction.findMany({
      where: { companyId: session.companyId, dataHora: { gte: monthStart, lt: monthEnd } },
      include: { vehicle: true, driver: true },
      orderBy: { dataHora: "desc" },
    }),
    prisma.vehicle.findMany({ where: { companyId: session.companyId } }),
    prisma.driver.findMany({ where: { companyId: session.companyId } }),
    prisma.anpPrecoReferencia.findMany({
      where: { semanaInicio: { lt: monthEnd }, semanaFim: { gte: monthStart } },
    }),
  ]);

  // Semanas ANP (domingo-a-sabado) que tocam o mes exibido, pra saber se
  // falta sincronizar alguma antes de mostrar o card de comparacao de preco.
  const weekStartsInMonth: Date[] = [];
  for (let c = anpWeekRange(monthStart).start; c < monthEnd; c = new Date(c.getFullYear(), c.getMonth(), c.getDate() + 7)) {
    weekStartsInMonth.push(c);
  }
  const syncedWeekKeys = new Set(refPrices.map((r) => r.semanaInicio.getTime()));
  const weeksMissing = weekStartsInMonth.filter((w) => !syncedWeekKeys.has(w.getTime())).length;

  const { semVeiculo, semMotorista } = findUnlinkedTransactions(txs);
  const inactiveLinks = findInactiveLinkTransactions(txs, vehicles, drivers);
  const duplicates = findSuspectedDuplicates(txs);
  const regressions = findOdometerRegressions(txs, vehicles);
  const semHodometro = txs.filter((t) => t.hodometro == null);
  const ranking = spentByVehicle(txs, vehicles).slice(0, 5);

  const overpriced = findOverpricedTransactions(txs, refPrices);
  const overpricedById = new Map(overpriced.map((o) => [o.id, o]));

  const duplicateIds = new Set(duplicates.map((t) => t.id));
  const regressionIds = new Set(regressions.map((t) => t.id));
  const inactiveLinkIds = new Set(inactiveLinks.map((t) => t.id));

  const totalCents = totalSpentCents(txs);
  const avgPriceCents = averagePriceCentsPerLiter(txs);

  // Filtros (placa/motorista/combustivel/situacao) sao aplicados so na
  // tabela — cards, ranking e as contagens acima refletem o mes inteiro,
  // pra nao dar a impressao de que o KPI mudou quando na verdade so a
  // lista visivel foi filtrada.
  const combustiveisDisponiveis = [...new Set(txs.map((t) => t.combustivel).filter((c): c is string => !!c))].sort();

  const matchesSituacao = (t: (typeof txs)[number]) => {
    switch (situacao) {
      case "sem_veiculo":
        return !t.vehicleId;
      case "sem_motorista":
        return !t.driverId;
      case "inativo":
        return inactiveLinkIds.has(t.id);
      case "duplicata":
        return duplicateIds.has(t.id);
      case "hodometro":
        return regressionIds.has(t.id);
      case "anp":
        return overpricedById.has(t.id);
      case "ok":
        return (
          !!t.vehicleId &&
          !!t.driverId &&
          !inactiveLinkIds.has(t.id) &&
          !duplicateIds.has(t.id) &&
          !regressionIds.has(t.id) &&
          !overpricedById.has(t.id)
        );
      default:
        return true;
    }
  };

  const placaFiltro = placa?.trim().toUpperCase();
  const motoristaFiltro = motorista?.trim().toLowerCase();
  const modeloFiltro = modelo?.trim().toLowerCase();
  const postoFiltro = posto?.trim().toLowerCase();
  const filteredTxs = txs.filter((t) => {
    if (placaFiltro && !(t.vehicle?.plate ?? t.placaOriginal).toUpperCase().includes(placaFiltro)) return false;
    if (motoristaFiltro && !(t.driver?.name ?? t.motoristaOriginal ?? "").toLowerCase().includes(motoristaFiltro))
      return false;
    if (modeloFiltro && !(t.vehicle?.model ?? t.modeloOriginal ?? "").toLowerCase().includes(modeloFiltro))
      return false;
    if (combustivel && t.combustivel !== combustivel) return false;
    if (postoFiltro && !(t.posto ?? "").toLowerCase().includes(postoFiltro)) return false;
    if (!matchesSituacao(t)) return false;
    return true;
  });

  // Ordenacao em memoria (nao via Prisma orderBy) pra sempre refletir o
  // mesmo valor exibido na celula — sortear por "vehicle.plate" via Prisma
  // nao funcionaria bem aqui, ja que a maioria das transacoes reais ainda
  // nao tem vehicleId vinculado (fica null pra todo mundo, sort vira
  // no-op); placaOriginal/motoristaOriginal/modeloOriginal sao preenchidos
  // sempre, vinculado ou nao.
  const sortValue = (t: (typeof txs)[number]): string | number => {
    switch (sortField) {
      case "placa":
        return t.vehicle?.plate ?? t.placaOriginal;
      case "motorista":
        return t.driver?.name ?? t.motoristaOriginal ?? "";
      case "modelo":
        return t.vehicle?.model ?? t.modeloOriginal ?? "";
      case "valor":
        return t.valorCents;
      case "litros":
        return t.volumeLitros;
      case "combustivel":
        return t.combustivel ?? "";
      case "hodometro":
        return t.hodometro ?? -Infinity;
      case "kmPorLitro":
        return t.kmRodados && t.volumeLitros > 0 ? t.kmRodados / t.volumeLitros : -Infinity;
      case "posto":
        return t.posto ?? "";
      default:
        return t.dataHora.getTime();
    }
  };
  filteredTxs.sort((a, b) => {
    const av = sortValue(a);
    const bv = sortValue(b);
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === "desc" ? -cmp : cmp;
  });

  const sortLinkParams = {
    mes: format(monthStart, "yyyy-MM"),
    placa,
    motorista,
    modelo,
    combustivel,
    posto,
    situacao,
  };

  const monthLinkHref = (mesAlvo: string) => {
    const params = new URLSearchParams();
    params.set("mes", mesAlvo);
    if (placa) params.set("placa", placa);
    if (motorista) params.set("motorista", motorista);
    if (modelo) params.set("modelo", modelo);
    if (combustivel) params.set("combustivel", combustivel);
    if (posto) params.set("posto", posto);
    if (situacao) params.set("situacao", situacao);
    if (sort) params.set("sort", sort);
    if (dir) params.set("dir", dir);
    return `/combustivel?${params.toString()}`;
  };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Combustível"
        subtitle="Extrato do cartão Ticket Log, cruzado com o cadastro de motoristas e veículos."
        secondaryActionHref="/combustivel/importar"
        secondaryActionLabel="Importar extrato"
      />
      <p className="mb-4 text-xs text-slate-400">
        <Link href="/combustivel/resumo" className="text-blue-700 hover:underline">
          Ver resumo de consumo por contrato →
        </Link>
      </p>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
            <Fuel className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Gasto total</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatBRL(totalCents)}</p>
          <p className="text-xs text-slate-500">no período</p>
          <div className="mt-3 flex items-end justify-between border-t border-slate-100 pt-3 text-sm">
            <div>
              <p className="font-semibold text-slate-900">
                {avgPriceCents !== null ? formatBRL(avgPriceCents) : "—"}
              </p>
              <p className="text-xs text-slate-500">preço médio por litro</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-slate-900">{txs.length}</p>
              <p className="text-xs text-slate-500">transações</p>
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <Link2Off className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Vínculo de cadastro</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{semVeiculo.length}</p>
          <p className="text-xs text-slate-500">sem veículo vinculado</p>
          <div className="mt-3 flex items-end justify-between border-t border-slate-100 pt-3 text-sm">
            <div>
              <p className="font-semibold text-slate-900">{semMotorista.length}</p>
              <p className="text-xs text-slate-500">sem motorista vinculado</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-slate-900">{inactiveLinks.length}</p>
              <p className="text-xs text-slate-500">veículo/motorista inativo</p>
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-700">
            <TriangleAlert className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Padrões atípicos</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{duplicates.length}</p>
          <p className="text-xs text-slate-500">possíveis duplicatas</p>
          <div className="mt-3 flex items-end justify-between border-t border-slate-100 pt-3 text-sm">
            <div>
              <p className="font-semibold text-slate-900">{regressions.length}</p>
              <p className="text-xs text-slate-500">hodômetro retrocedido</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-slate-900">{semHodometro.length}</p>
              <p className="text-xs text-slate-500">sem hodômetro informado</p>
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
            <Gauge className="h-4 w-4" />
          </div>
          <p className="text-sm text-slate-500">Preço ANP</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{overpriced.length}</p>
          <p className="text-xs text-slate-500">acima da média da região (+10%)</p>
          <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
            {weeksMissing > 0 ? (
              <form action={syncAnpPrices.bind(null, format(monthStart, "yyyy-MM"))}>
                <p className="mb-2 text-xs text-slate-500">
                  {weeksMissing} de {weekStartsInMonth.length} semana(s) ainda não sincronizada(s)
                </p>
                <button type="submit" className={`${primaryButtonClass} w-full py-1.5 text-xs`}>
                  Buscar preços ANP
                </button>
              </form>
            ) : (
              <p className="text-xs text-slate-500">Preços da ANP sincronizados para o período.</p>
            )}
          </div>
        </div>
      </div>

      {ranking.length > 0 && (
        <div className={`${cardClass} mb-6`}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Trophy className="h-4 w-4 text-amber-500" /> Veículos com maior gasto
          </h2>
          <ul className="flex flex-col gap-2">
            {ranking.map((r) => (
              <li key={r.vehicleId} className="flex items-center justify-between text-sm">
                <span className="font-mono text-slate-700">{r.plate}</span>
                <span className={`${badgeClass} bg-blue-100 text-blue-700`}>{formatBRL(r.cents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <Link
          href={monthLinkHref(prevMonth)}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" /> Mês anterior
        </Link>
        <p className="text-sm font-medium text-slate-700">{format(monthStart, "MMMM/yyyy")}</p>
        <Link
          href={monthLinkHref(nextMonth)}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Próximo mês <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="mes" value={format(monthStart, "yyyy-MM")} />
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Placa</label>
          <input
            type="text"
            name="placa"
            defaultValue={placa ?? ""}
            placeholder="ex.: ABC1D23"
            className={`${inputClass} w-32`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Motorista</label>
          <input
            type="text"
            name="motorista"
            defaultValue={motorista ?? ""}
            placeholder="nome"
            className={`${inputClass} w-44`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Modelo</label>
          <input
            type="text"
            name="modelo"
            defaultValue={modelo ?? ""}
            placeholder="ex.: MASTER"
            className={`${inputClass} w-36`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Combustível</label>
          <select name="combustivel" defaultValue={combustivel ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {combustiveisDisponiveis.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Posto</label>
          <input
            type="text"
            name="posto"
            defaultValue={posto ?? ""}
            placeholder="nome do posto"
            className={`${inputClass} w-40`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Situação</label>
          <select name="situacao" defaultValue={situacao ?? ""} className={inputClass}>
            {SITUACAO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
        {(placa || motorista || modelo || combustivel || posto || situacao) && (
          <Link
            href={`/combustivel?mes=${format(monthStart, "yyyy-MM")}`}
            className="text-sm text-slate-500 hover:underline"
          >
            Limpar filtros
          </Link>
        )}
      </form>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <SortableTh label="Data/Hora" field="dataHora" basePath="/combustivel" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Placa" field="placa" basePath="/combustivel" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Motorista" field="motorista" basePath="/combustivel" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Modelo" field="modelo" basePath="/combustivel" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Valor" field="valor" basePath="/combustivel" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Litros" field="litros" basePath="/combustivel" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Combustível" field="combustivel" basePath="/combustivel" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Hodômetro" field="hodometro" basePath="/combustivel" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Km/L" field="kmPorLitro" basePath="/combustivel" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Posto" field="posto" basePath="/combustivel" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <th className="px-4 py-3">Situação</th>
              </tr>
            </thead>
            <tbody>
              {filteredTxs.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma transação de combustível encontrada.
                  </td>
                </tr>
              )}
              {filteredTxs.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 text-slate-600">{format(t.dataHora, "dd/MM/yyyy HH:mm")}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {t.vehicle?.plate ?? t.placaOriginal}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{t.driver?.name ?? t.motoristaOriginal ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{t.vehicle?.model ?? t.modeloOriginal ?? "—"}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{formatBRL(t.valorCents)}</td>
                  <td className="px-4 py-3 text-slate-600">{t.volumeLitros.toLocaleString("pt-BR")} L</td>
                  <td className="px-4 py-3 text-slate-600">{t.combustivel ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {t.hodometro !== null ? t.hodometro.toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {t.kmRodados && t.volumeLitros > 0
                      ? (t.kmRodados / t.volumeLitros).toLocaleString("pt-BR", { maximumFractionDigits: 2 })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{t.posto ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {!t.vehicleId && <span className={`${badgeClass} bg-amber-100 text-amber-700`}>Sem veículo</span>}
                      {!t.driverId && <span className={`${badgeClass} bg-amber-100 text-amber-700`}>Sem motorista</span>}
                      {inactiveLinkIds.has(t.id) && (
                        <span className={`${badgeClass} bg-amber-100 text-amber-700`}>Vínculo inativo</span>
                      )}
                      {duplicateIds.has(t.id) && (
                        <span className={`${badgeClass} bg-red-100 text-red-700`}>Duplicata suspeita</span>
                      )}
                      {regressionIds.has(t.id) && (
                        <span className={`${badgeClass} bg-red-100 text-red-700`}>Hodômetro retrocedido</span>
                      )}
                      {overpricedById.has(t.id) && (
                        <span className={`${badgeClass} bg-orange-100 text-orange-700`}>
                          Acima do ANP (+{overpricedById.get(t.id)!.deltaPercent.toFixed(0)}%)
                        </span>
                      )}
                      {t.vehicleId &&
                        t.driverId &&
                        !inactiveLinkIds.has(t.id) &&
                        !duplicateIds.has(t.id) &&
                        !regressionIds.has(t.id) &&
                        !overpricedById.has(t.id) && (
                          <span className={`${badgeClass} bg-emerald-100 text-emerald-700`}>OK</span>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
