import { format, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRight, FlaskConical, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { formatHoursMinutes } from "@/lib/time";
import PageHeader from "@/components/ui/PageHeader";
import { buildSimulationReport, type EscalaSimulada, type RegimeSimulado, type SimulationScenarioResult } from "@/lib/simulacaoCenario";

const currency = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function DeltaBadge({
  atual,
  simulado,
  invertGood = false,
  formatDelta = (n: number) => String(n),
}: {
  atual: number;
  simulado: number;
  invertGood?: boolean;
  // Recebe sempre o valor absoluto do delta — o sinal (+/-) e adicionado
  // pelo proprio componente, pra formatadores como formatHoursMinutes (que
  // nao lida bem com minutos negativos) nao precisarem se preocupar com isso.
  formatDelta?: (absDelta: number) => string;
}) {
  const delta = simulado - atual;
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
        <Minus className="h-3 w-3" /> sem mudança
      </span>
    );
  }
  const isIncrease = delta > 0;
  const isBad = invertGood ? !isIncrease : isIncrease;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${isBad ? "text-red-600" : "text-emerald-600"}`}>
      {isIncrease ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isIncrease ? "+" : "-"}
      {formatDelta(Math.abs(delta))}
    </span>
  );
}

export default async function SimuladorCenarioPage({
  searchParams,
}: {
  searchParams: Promise<{
    mes?: string;
    driverId?: string;
    regime?: string;
    escala?: string;
    valorHora?: string;
    limiteDiario?: string;
  }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR", "FOLHA");
  const { mes, driverId, regime, escala, valorHora, limiteDiario } = await searchParams;

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);

  const drivers = await prisma.driver.findMany({
    where: { companyId: session.companyId, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const selectedDriverId = driverId || drivers[0]?.id || "";
  const regimeSim: RegimeSimulado = regime === "padrao" || regime === "doze_x_trinta_seis" ? regime : "atual";
  const escalaSim: EscalaSimulada =
    escala === "sem_limite" || escala === "seis_um" || escala === "cinco_dois" ? escala : "atual";
  const valorHoraCentsInput = valorHora ? Math.round(parseFloat(valorHora.replace(",", ".")) * 100) : null;
  const limiteDiarioMinutosInput = limiteDiario ? Math.round(parseFloat(limiteDiario.replace(",", ".")) * 60) : null;

  const report = selectedDriverId
    ? await buildSimulationReport(session.companyId, selectedDriverId, monthStart, {
        regime: regimeSim,
        escala: escalaSim,
        valorHoraCents: valorHoraCentsInput,
        limiteDiarioMinutosOverride: limiteDiarioMinutosInput,
      })
    : null;

  const scenarioRows: { label: string; atualLabel: string; simuladoLabel: string; delta: React.ReactNode }[] = report
    ? [
        {
          label: "Horas extras",
          atualLabel: formatHoursMinutes(report.atual.overtimeMinutes),
          simuladoLabel: formatHoursMinutes(report.simulado.overtimeMinutes),
          delta: (
            <DeltaBadge
              atual={report.atual.overtimeMinutes}
              simulado={report.simulado.overtimeMinutes}
              formatDelta={formatHoursMinutes}
            />
          ),
        },
        {
          label: "Violações de interjornada",
          atualLabel: String(report.atual.interjornadaCount),
          simuladoLabel: String(report.simulado.interjornadaCount),
          delta: <DeltaBadge atual={report.atual.interjornadaCount} simulado={report.simulado.interjornadaCount} />,
        },
        {
          label: "Violações de DSR",
          atualLabel: String(report.atual.dsrCount),
          simuladoLabel: String(report.simulado.dsrCount),
          delta: <DeltaBadge atual={report.atual.dsrCount} simulado={report.simulado.dsrCount} />,
        },
      ]
    : [];

  const costRow = (label: string, atual: SimulationScenarioResult, simulado: SimulationScenarioResult, pick: (s: SimulationScenarioResult) => number) => (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className="flex items-center gap-2 font-medium text-slate-800">
        {currency(pick(atual))} <ArrowRight className="h-3 w-3 text-slate-400" /> {currency(pick(simulado))}
      </span>
    </div>
  );

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Simulador de cenário"
        subtitle="Compara o custo e o risco de um motorista sob a configuração atual contra uma hipótese — antes de mudar regime, escala ou valor-hora de verdade."
      />

      <form method="get" className={`${cardClass} mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4`}>
        <div>
          <label className={labelClass}>Motorista</label>
          <select name="driverId" defaultValue={selectedDriverId} className={inputClass}>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Mês</label>
          <input type="month" name="mes" defaultValue={format(monthStart, "yyyy-MM")} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Regime (simulado)</label>
          <select name="regime" defaultValue={regimeSim} className={inputClass}>
            <option value="atual">Manter atual</option>
            <option value="padrao">Padrão (8h ou CCT)</option>
            <option value="doze_x_trinta_seis">12x36 (art. 59-A CLT)</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Escala (simulada)</label>
          <select name="escala" defaultValue={escalaSim} className={inputClass}>
            <option value="atual">Manter atual</option>
            <option value="sem_limite">Sem escala especial</option>
            <option value="seis_um">6x1</option>
            <option value="cinco_dois">5x2</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Valor-hora simulado (R$)</label>
          <input
            type="text"
            name="valorHora"
            defaultValue={valorHora ?? ""}
            placeholder="Deixe em branco para manter"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Limite diário simulado (horas)</label>
          <input
            type="text"
            name="limiteDiario"
            defaultValue={limiteDiario ?? ""}
            placeholder="Deixe em branco para manter"
            className={inputClass}
          />
        </div>
        <div className="flex items-end sm:col-span-2 lg:col-span-2">
          <button type="submit" className={primaryButtonClass}>
            Simular
          </button>
        </div>
      </form>

      {!report && (
        <div className={cardClass}>
          <p className="text-sm text-slate-500">Cadastre ao menos um motorista ativo para simular um cenário.</p>
        </div>
      )}

      {report && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className={cardClass}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <FlaskConical className="h-4 w-4" />
              </div>
              <p className="text-sm text-slate-500">{report.driverName}</p>
              <p className="mt-1 text-xs text-slate-500">
                {format(monthStart, "MMMM/yyyy", { locale: ptBR })} — comparação entre a configuração atual do
                cadastro e a hipótese selecionada, usando os registros de ponto reais do mês.
              </p>
            </div>
            <div className={cardClass}>
              <p className="text-sm text-slate-500">Custo total estimado no mês</p>
              {report.hasValorHora ? (
                <p className="mt-1 flex items-center gap-2 text-2xl font-semibold text-slate-900">
                  {currency(report.atual.totalCostCents ?? 0)}
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                  {currency(report.simulado.totalCostCents ?? 0)}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Configure o valor-hora do motorista para ver o custo.</p>
              )}
              <DeltaBadge
                atual={report.atual.totalCostCents ?? 0}
                simulado={report.simulado.totalCostCents ?? 0}
                formatDelta={(cents) => currency(cents)}
              />
            </div>
          </div>

          <div className={`${cardClass} mb-6`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Atual → Simulado</h2>
            <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-3">
              <div className="col-span-1 hidden sm:block" />
              <div className="hidden text-right text-xs font-medium uppercase tracking-wide text-slate-400 sm:block">
                Atual
              </div>
              <div className="hidden text-right text-xs font-medium uppercase tracking-wide text-slate-400 sm:block">
                Simulado
              </div>
            </div>
            {scenarioRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between border-b border-slate-100 py-2.5 text-sm last:border-0">
                <span className="text-slate-600">{row.label}</span>
                <span className="flex items-center gap-3">
                  <span className="w-16 text-right text-slate-800">{row.atualLabel}</span>
                  <ArrowRight className="h-3 w-3 text-slate-400" />
                  <span className="w-16 text-right font-medium text-slate-800">{row.simuladoLabel}</span>
                  <span className="w-20 text-right">{row.delta}</span>
                </span>
              </div>
            ))}
          </div>

          {report.hasValorHora && (
            <div className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Detalhamento do custo estimado</h2>
              {costRow("Hora extra", report.atual, report.simulado, (s) => s.overtimeCostCents ?? 0)}
              {costRow("Interjornada insuficiente", report.atual, report.simulado, (s) => s.interjornadaCostCents)}
              {costRow("DSR não concedido", report.atual, report.simulado, (s) => s.dsrCostCents)}
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Simulação usa as batidas de ponto reais do motorista no mês, recalculadas sob os parâmetros escolhidos — não
        altera nenhum cadastro nem cria registro algum. Estimativa de decisão, não cálculo pericial nem
        aconselhamento jurídico. Mesmas fórmulas do{" "}
        <a href="/ponto/passivo" className="underline">
          Passivo trabalhista
        </a>
        .
      </p>
    </div>
  );
}
