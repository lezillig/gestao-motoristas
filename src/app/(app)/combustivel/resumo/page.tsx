import Link from "next/link";
import { Banknote, Fuel as FuelIcon, Gauge, Trophy } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import { spentByContrato } from "@/lib/fuelCompliance";
import type { Prisma } from "@prisma/client";

const SORT_FIELDS = ["placa", "contrato", "combustivel", "total"] as const;
type SortField = (typeof SORT_FIELDS)[number];

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function periodoKey(inicio: Date, fim: Date): string {
  return `${inicio.toISOString().slice(0, 10)}_${fim.toISOString().slice(0, 10)}`;
}

export default async function ResumoConsumoPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; sort?: string; dir?: string }>;
}) {
  const session = await requireSession();
  const { periodo, sort, dir } = await searchParams;

  const periodosDisponiveis = await prisma.fuelConsumptionSummary.findMany({
    where: { companyId: session.companyId },
    distinct: ["periodoInicio", "periodoFim"],
    select: { periodoInicio: true, periodoFim: true },
    orderBy: { periodoInicio: "desc" },
  });

  const selected =
    periodosDisponiveis.find((p) => periodoKey(p.periodoInicio, p.periodoFim) === periodo) ??
    periodosDisponiveis[0];

  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "total";
  const sortDir = dir === "asc" ? "asc" : "desc";
  const orderBy: Prisma.FuelConsumptionSummaryOrderByWithRelationInput =
    sortField === "placa"
      ? { placaOriginal: sortDir }
      : sortField === "contrato"
        ? { contrato: sortDir }
        : sortField === "combustivel"
          ? { tipoCombustivel: sortDir }
          : { totalCents: sortDir };

  const summaries = selected
    ? await prisma.fuelConsumptionSummary.findMany({
        where: {
          companyId: session.companyId,
          periodoInicio: selected.periodoInicio,
          periodoFim: selected.periodoFim,
        },
        include: { vehicle: true },
        orderBy,
      })
    : [];

  const totalCents = summaries.reduce((s, r) => s + r.totalCents, 0);
  const totalLitros = summaries.reduce((s, r) => s + r.litros, 0);
  const contratos = new Set(summaries.map((s) => s.contrato));
  const comKm = summaries.filter((s) => s.kmRodados && s.kmRodados > 0);
  const totalKm = comKm.reduce((s, r) => s + (r.kmRodados ?? 0), 0);
  const custoPorKm = totalKm > 0 ? comKm.reduce((s, r) => s + r.totalCents, 0) / totalKm : null;
  const ranking = spentByContrato(summaries).slice(0, 5);

  const sortLinkParams = selected ? { periodo: periodoKey(selected.periodoInicio, selected.periodoFim) } : {};

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Resumo de consumo por contrato"
        subtitle="Relatório resumido do sistema de gestão de frota — um total por veículo e contrato no período, sem detalhe de transação."
        secondaryActionHref="/combustivel/resumo/importar"
        secondaryActionLabel="Importar relatório"
      />
      <p className="mb-4 text-xs text-slate-400">
        <Link href="/combustivel" className="text-blue-700 hover:underline">
          ← Ver extrato transacional
        </Link>
      </p>

      {periodosDisponiveis.length === 0 ? (
        <div className={cardClass}>
          <p className="text-sm text-slate-500">
            Nenhum relatório importado ainda.{" "}
            <Link href="/combustivel/resumo/importar" className="text-blue-700 hover:underline">
              Importar o primeiro relatório
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <form className="mb-6 flex flex-wrap items-end gap-3" method="get">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Período</label>
              <select
                name="periodo"
                defaultValue={selected ? periodoKey(selected.periodoInicio, selected.periodoFim) : ""}
                className={inputClass}
              >
                {periodosDisponiveis.map((p) => {
                  const key = periodoKey(p.periodoInicio, p.periodoFim);
                  return (
                    <option key={key} value={key}>
                      {p.periodoInicio.toLocaleDateString("pt-BR")} a {p.periodoFim.toLocaleDateString("pt-BR")}
                    </option>
                  );
                })}
              </select>
            </div>
            <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Filtrar
            </button>
          </form>

          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className={cardClass}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                <Banknote className="h-4 w-4" />
              </div>
              <p className="text-sm text-slate-500">Gasto total</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{formatBRL(totalCents)}</p>
              <p className="text-xs text-slate-500">no período selecionado</p>
            </div>
            <div className={cardClass}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
                <FuelIcon className="h-4 w-4" />
              </div>
              <p className="text-sm text-slate-500">Litros</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{totalLitros.toLocaleString("pt-BR")} L</p>
              <p className="text-xs text-slate-500">todos os combustíveis</p>
            </div>
            <div className={cardClass}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <Gauge className="h-4 w-4" />
              </div>
              <p className="text-sm text-slate-500">Custo por km</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {custoPorKm !== null ? formatBRL(custoPorKm) : "—"}
              </p>
              <p className="text-xs text-slate-500">veículos com km rodado informado</p>
            </div>
            <div className={cardClass}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <Trophy className="h-4 w-4" />
              </div>
              <p className="text-sm text-slate-500">Contratos</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{contratos.size}</p>
              <p className="text-xs text-slate-500">com consumo no período</p>
            </div>
          </div>

          {ranking.length > 0 && (
            <div className={`${cardClass} mb-6`}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Trophy className="h-4 w-4 text-amber-500" /> Contratos com maior gasto
              </h2>
              <ul className="flex flex-col gap-2">
                {ranking.map((r) => (
                  <li key={r.contrato} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{r.contrato}</span>
                    <span className={`${badgeClass} bg-blue-100 text-blue-700`}>{formatBRL(r.cents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={`${cardClass} p-0 overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <SortableTh label="Placa" field="placa" basePath="/combustivel/resumo" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                    <SortableTh label="Contrato" field="contrato" basePath="/combustivel/resumo" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                    <SortableTh label="Combustível" field="combustivel" basePath="/combustivel/resumo" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                    <th className="px-4 py-3">Km rodados</th>
                    <th className="px-4 py-3">Litros</th>
                    <th className="px-4 py-3">Valor médio/L</th>
                    <SortableTh label="Total" field="total" basePath="/combustivel/resumo" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {summaries.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        Nenhum registro neste período.
                      </td>
                    </tr>
                  )}
                  {summaries.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {s.vehicle?.plate ?? s.placaOriginal}
                        {!s.vehicleId && (
                          <span className={`${badgeClass} ml-1.5 bg-amber-100 text-amber-700`}>Sem vínculo</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{s.contrato}</td>
                      <td className="px-4 py-3 text-slate-600">{s.tipoCombustivel}</td>
                      <td className="px-4 py-3 text-slate-600">{s.kmRodados?.toLocaleString("pt-BR") ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{s.litros.toLocaleString("pt-BR")} L</td>
                      <td className="px-4 py-3 text-slate-600">
                        {s.valorMedioLitroCents !== null ? formatBRL(s.valorMedioLitroCents) : "—"}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">{formatBRL(s.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
