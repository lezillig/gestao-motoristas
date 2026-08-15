import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { History, DollarSign, Users } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { formatHoursMinutes } from "@/lib/time";
import { workedMinutes, overtimeMinutes } from "@/lib/pontoCompliance";
import { driverDailyLimitMinutes, overtimeCostCents } from "@/lib/convencao";
import { parseLocalDate } from "@/lib/date";
import type { Prisma } from "@prisma/client";

type DriverWithConvencoes = Prisma.DriverGetPayload<{
  include: { sindicato: { include: { convencoes: { include: { regras: true } } } } };
}>;

function turno(
  clockIn: string,
  clockOut: string | null,
  intervaloInicio: string | null,
  intervaloFim: string | null,
  punches: unknown
) {
  if (!clockOut) return { range: `${clockIn}–?`, worked: "em aberto", minutes: null as number | null };
  const minutes = workedMinutes({ clockIn, clockOut, intervaloInicio, intervaloFim, punches });
  return { range: `${clockIn}–${clockOut}`, worked: minutes !== null ? formatHoursMinutes(minutes) : "em aberto", minutes };
}

const currency = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function PontoCorrecoesPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const session = await requireSession();
  const { de, ate } = await searchParams;

  const where: Prisma.TimeClockCorrectionWhereInput = { companyId: session.companyId };
  if (de || ate) {
    where.date = {};
    if (de) where.date.gte = parseLocalDate(de);
    if (ate) where.date.lte = parseLocalDate(ate);
  }

  const corrections = await prisma.timeClockCorrection.findMany({
    where,
    include: {
      driver: { include: { sindicato: { include: { convencoes: { include: { regras: true } } } } } },
    },
    orderBy: { date: "desc" },
  });

  const affectedDrivers = new Set(corrections.map((c) => c.driverId)).size;

  // Impacto financeiro: compara o custo de hora extra do turno ANTES vs
  // DEPOIS da correcao, por motorista (limite diario e percentual de hora
  // extra resolvidos na data real do turno, nao em "hoje" — uma correcao
  // pode ser feita meses depois do turno, e a CCT/ACT vigente naquele dia
  // pode ja ter mudado desde entao). So soma motoristas com valor-hora
  // cadastrado; os demais ficam de fora da soma mas sao contados a parte,
  // mesmo padrao ja usado no card de custo de hora extra de /ponto/analise.
  let impactCents = 0;
  let semValorHora = 0;
  const rows = corrections.map((c) => {
    const driver = c.driver as DriverWithConvencoes;
    const antes = turno(c.clockInAntes, c.clockOutAntes, c.intervaloInicioAntes, c.intervaloFimAntes, c.punchesAntes);
    const depois = turno(c.clockInDepois, c.clockOutDepois, c.intervaloInicioDepois, c.intervaloFimDepois, c.punchesDepois);

    let impactoCents: number | null = null;
    if (antes.minutes !== null && depois.minutes !== null) {
      const limit = driverDailyLimitMinutes(driver, c.date).minutes;
      const overtimeAntes = overtimeMinutes(antes.minutes, limit);
      const overtimeDepois = overtimeMinutes(depois.minutes, limit);
      const costAntes = overtimeCostCents(driver, overtimeAntes, c.date);
      const costDepois = overtimeCostCents(driver, overtimeDepois, c.date);
      if (costAntes !== null && costDepois !== null) {
        // Positivo = o valor antigo (errado) calculava MAIS hora extra do
        // que o correto — ou seja, o quanto estava sendo indevidamente
        // atribuido a mais (risco de pagar hora extra que nao existiu).
        // Negativo indicaria o oposto (bateria menos hora extra do que o
        // real, subestimando).
        impactoCents = costAntes - costDepois;
        impactCents += impactoCents;
      } else {
        semValorHora++;
      }
    }

    return { c, antes, depois, impactoCents };
  });

  const periodLabel =
    de || ate
      ? `${de ? format(parseLocalDate(de), "dd/MM/yyyy") : "início"} até ${ate ? format(parseLocalDate(ate), "dd/MM/yyyy") : "hoje"}`
      : "todo o período";

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Histórico de correções"
        subtitle="Turnos importados do TiqueTaque que foram atualizados numa reimportação porque a correção foi feita direto no TiqueTaque."
      />

      <form className="mb-6 flex flex-wrap items-end gap-3" method="get">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">De</label>
          <input type="date" name="de" defaultValue={de ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Até</label>
          <input type="date" name="ate" defaultValue={ate ?? ""} className={inputClass} />
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
        {(de || ate) && (
          <Link href="/ponto/correcoes" className="text-sm text-slate-500 hover:underline">
            Ver tudo
          </Link>
        )}
      </form>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <History className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{corrections.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Correções em {periodLabel}</p>
        </div>
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Users className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{affectedDrivers}</p>
          <p className="mt-0.5 text-xs text-slate-500">Motoristas afetados</p>
        </div>
        <div className={cardClass}>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <DollarSign className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{currency(impactCents)}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Hora extra calculada a mais antes da correção{semValorHora > 0 ? ` · ${semValorHora} sem valor-hora, fora da soma` : ""}
          </p>
        </div>
      </div>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Motorista</th>
                <th className="px-3 py-3">Data</th>
                <th className="px-3 py-3">Turno anterior</th>
                <th className="px-3 py-3">Turno corrigido</th>
                <th className="px-3 py-3">Impacto</th>
                <th className="px-3 py-3">Corrigido em</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma correção registrada em {periodLabel}.
                  </td>
                </tr>
              )}
              {rows.map(({ c, antes, depois, impactoCents }) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{c.driver.name}</td>
                  <td className="px-3 py-2.5 text-slate-600">{format(c.date, "dd/MM/yyyy")}</td>
                  <td className="px-3 py-2.5 text-slate-400 line-through decoration-slate-300">
                    {antes.range}
                    <span className="ml-1 no-underline">({antes.worked})</span>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-amber-700">
                    {depois.range} <span className="text-amber-600">({depois.worked})</span>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-slate-700">
                    {impactoCents === null ? "—" : currency(impactoCents)}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{format(c.corrigidoEm, "dd/MM/yyyy HH:mm")}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/ponto/${c.entryId}`} className="text-blue-600 hover:underline">
                      Ver registro
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        O impacto é o quanto de hora extra estava sendo calculado a mais (ou a menos, se negativo)
        antes da correção, usando o limite diário e o percentual de hora extra vigentes na data
        real do turno (não na data em que a correção foi feita).
      </p>
    </div>
  );
}
