import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { requireRole } from "@/lib/auth";
import { cardClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import SortableTh from "@/components/ui/SortableTh";
import { formatHoursMinutes } from "@/lib/time";
import { BANCO_HORAS_WINDOW_MONTHS, buildBancoHorasReport } from "@/lib/bancoHoras";
import BancoHorasDriverRow from "./BancoHorasDriverRow";
import BancoHorasExportBar from "./BancoHorasExportBar";

const SORT_FIELDS = ["motorista", "credito", "debito", "saldo"] as const;
type SortField = (typeof SORT_FIELDS)[number];

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return format(new Date(year, month - 1, 1), "MMM/yyyy", { locale: ptBR });
}

export default async function BancoHorasPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR", "FOLHA");
  const { sort, dir } = await searchParams;

  const sortField: SortField = SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : "saldo";
  const sortDir = dir === "asc" ? "asc" : "desc";
  const sortLinkParams = {};

  const report = await buildBancoHorasReport(session.companyId);

  const compare: Record<SortField, (a: (typeof report)[number], b: (typeof report)[number]) => number> = {
    motorista: (a, b) => a.driverName.localeCompare(b.driverName),
    credito: (a, b) => a.balance.creditMinutes - b.balance.creditMinutes,
    debito: (a, b) => a.balance.debitMinutes - b.balance.debitMinutes,
    saldo: (a, b) => a.balance.balanceMinutes - b.balance.balanceMinutes,
  };
  const balances = [...report].sort((a, b) => {
    const cmp = compare[sortField](a, b);
    return sortDir === "desc" ? -cmp : cmp;
  });

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Banco de horas"
        subtitle={`Saldo estimado de hora extra (crédito) menos folgas compensadas (débito) nos últimos ${BANCO_HORAS_WINDOW_MONTHS} meses.`}
      />

      <div className="mb-6">
        <BancoHorasExportBar />
      </div>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto scroll-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <SortableTh label="Motorista" field="motorista" basePath="/ponto/banco-horas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3" />
                <SortableTh label="Crédito (hora extra)" field="credito" basePath="/ponto/banco-horas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3 text-right" />
                <SortableTh label="Débito (folgas)" field="debito" basePath="/ponto/banco-horas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3 text-right" />
                <SortableTh label="Saldo" field="saldo" basePath="/ponto/banco-horas" currentParams={sortLinkParams} currentSort={sortField} currentDir={sortDir} className="px-4 py-3 text-right" />
                <th className="px-4 py-3">Alerta</th>
              </tr>
            </thead>
            <tbody>
              {balances.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Nenhum saldo de banco de horas no período.
                  </td>
                </tr>
              )}
              {balances.map(({ driverId, driverName, balance }) => (
                <BancoHorasDriverRow
                  key={driverId}
                  driverName={driverName}
                  creditLabel={formatHoursMinutes(balance.creditMinutes)}
                  debitLabel={formatHoursMinutes(balance.debitMinutes)}
                  balanceLabel={formatHoursMinutes(Math.max(0, balance.balanceMinutes))}
                  positiveBalance={balance.balanceMinutes > 0}
                  atRisk={balance.atRisk}
                  atRiskTitle={`Crédito de hora extra desde ${balance.oldestUnconsumedCreditMonth} ainda não compensado — perto do limite de ${BANCO_HORAS_WINDOW_MONTHS} meses (art. 59, §§5º-6º CLT). O excedente pode ter que ser pago em vez de compensado (Súmula 85, IV, TST).`}
                  months={balance.monthly.map((m) => ({
                    label: monthLabel(m.monthKey),
                    creditLabel: formatHoursMinutes(m.creditMinutes),
                    debitLabel: formatHoursMinutes(m.debitMinutes),
                    balanceLabel: formatHoursMinutes(Math.max(0, m.balanceMinutes)),
                  }))}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Clique no nome do motorista para ver o detalhamento mês a mês. Ordenado por saldo (maior primeiro) por
        padrão — clique numa coluna pra reordenar.
      </p>
      <p className="mt-1 text-xs text-slate-400">
        Débito aproximado pelo limite diário de cada motorista por folga tirada (não há registro de quantas horas
        cada folga efetivamente compensou) — é uma estimativa para acompanhamento, não um saldo contábil exato. Não
        é aconselhamento jurídico.
      </p>
    </div>
  );
}
