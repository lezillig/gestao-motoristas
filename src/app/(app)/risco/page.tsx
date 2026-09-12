import Link from "next/link";
import { format } from "date-fns";
import { Gauge, Gavel, IdCard, SearchCheck, Siren, AlarmClockOff } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import {
  buildRiscoMotoristas,
  PONTOS_CNH_ATENCAO,
  PONTOS_CNH_SUSPENSAO_EAR,
  RISCO_JANELA_PADRAO_DIAS,
  RISCO_JANELAS_DIAS,
  type NivelRisco,
} from "@/lib/riscoMotorista";
import { SPEED_LIMIT_KMH } from "@/lib/speedCompliance";

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const NIVEL_BADGE: Record<NivelRisco, string> = {
  alto: "bg-red-100 text-red-700",
  medio: "bg-amber-100 text-amber-700",
  baixo: "bg-emerald-100 text-emerald-700",
};
const NIVEL_LABEL: Record<NivelRisco, string> = { alto: "Alto", medio: "Médio", baixo: "Baixo" };

function Tile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  sub?: string;
  tone: "critical" | "warning" | "neutral";
}) {
  const toneClass = {
    critical: "bg-red-100 text-red-700",
    warning: "bg-amber-100 text-amber-700",
    neutral: "bg-slate-100 text-slate-600",
  }[value > 0 ? tone : "neutral"];
  return (
    <div className={cardClass}>
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default async function RiscoMotoristasPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; todos?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { dias: diasParam, todos } = await searchParams;
  const dias = (RISCO_JANELAS_DIAS as readonly number[]).includes(Number(diasParam))
    ? Number(diasParam)
    : RISCO_JANELA_PADRAO_DIAS;
  const mostrarTodos = todos === "1";

  const risco = await buildRiscoMotoristas(session.companyId, dias);
  const comSinal = risco.motoristas.filter((m) => m.score > 0);
  const lista = mostrarTodos ? risco.motoristas : comSinal;
  const semSinal = risco.motoristas.length - comSinal.length;

  return (
    <div>
      <PageHeader
        title="Risco por motorista"
        subtitle="Quem precisa de atenção primeiro — CNH, multas e pontos, condução na Ituran, descanso entre turnos e faltas, num ranking só."
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Período:</span>
        {RISCO_JANELAS_DIAS.map((d) => (
          <Link
            key={d}
            href={`/risco?dias=${d}${mostrarTodos ? "&todos=1" : ""}`}
            className={`${badgeClass} ${d === dias ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            últimos {d} dias
          </Link>
        ))}
        <span className="ml-auto text-xs text-slate-400">
          Pontos na CNH sempre em 12 meses (regra do CTB) · até ontem, o último dia fechado
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Tile icon={Siren} label="Risco alto" value={risco.totais.alto} tone="critical" />
        <Tile icon={Siren} label="Risco médio" value={risco.totais.medio} tone="warning" />
        <Tile
          icon={IdCard}
          label={`${PONTOS_CNH_ATENCAO}+ pontos em 12 meses`}
          value={risco.totais.pontosAtencao}
          sub={`suspensão aos ${PONTOS_CNH_SUSPENSAO_EAR} pts (atividade remunerada)`}
          tone="critical"
        />
        <Tile
          icon={Gauge}
          label={`Viagens acima de ${SPEED_LIMIT_KMH} km/h`}
          value={risco.totais.excessos}
          sub={`${risco.totais.viagensTotal - risco.totais.viagensSemMotorista} de ${risco.totais.viagensTotal} viagens com motorista identificado`}
          tone="warning"
        />
        <Tile icon={AlarmClockOff} label="Descansos entre turnos abaixo do mínimo" value={risco.totais.interjornada} tone="warning" />
      </div>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">Risco</th>
                <th className="px-4 py-3">CNH</th>
                <th className="px-4 py-3">Multas</th>
                <th className="px-4 py-3">Condução (Ituran)</th>
                <th className="px-4 py-3">Ponto</th>
                <th className="px-4 py-3">Faltas</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-emerald-700">
                    Nenhum motorista com sinal de risco nos últimos {dias} dias.
                  </td>
                </tr>
              )}
              {lista.map((m, i) => (
                <tr key={m.driverId} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{m.driverName}</p>
                    <p className="text-xs text-slate-500">{m.funcao ?? "Cargo não informado"}</p>
                    {m.motivos.length > 0 && (
                      <ul className="mt-1.5 flex flex-wrap gap-1">
                        {m.motivos.map((mot) => (
                          <li key={mot} className={`${badgeClass} bg-slate-100 text-slate-600`}>
                            {mot}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`${badgeClass} ${NIVEL_BADGE[m.nivel]}`}>
                      {NIVEL_LABEL[m.nivel]} · {m.score}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {m.cnh.nivel === "vencida" && <span className="font-medium text-red-700">Vencida há {Math.abs(m.cnh.dias ?? 0)}d</span>}
                    {m.cnh.nivel === "vence_em_breve" && <span className="font-medium text-amber-700">Vence em {m.cnh.dias}d</span>}
                    {m.cnh.nivel === "pendente" && <span className="text-slate-500">Não cadastrada</span>}
                    {m.cnh.nivel === "ok" && m.cnh.expiration && <span>OK · {format(m.cnh.expiration, "dd/MM/yyyy")}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {m.multas.total === 0 && m.multas.pontos12m === 0 ? (
                      "—"
                    ) : (
                      <>
                        <p>
                          {m.multas.total} no período · {formatBRL(m.multas.valorCents)}
                        </p>
                        <p
                          className={
                            m.multas.pontos12m >= PONTOS_CNH_SUSPENSAO_EAR
                              ? "font-medium text-red-700"
                              : m.multas.pontos12m >= PONTOS_CNH_ATENCAO
                                ? "font-medium text-amber-700"
                                : ""
                          }
                        >
                          {m.multas.pontos12m} pts / 12 meses
                        </p>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {m.conducao.viagens === 0 ? (
                      <span className="text-slate-400">sem viagem atribuída</span>
                    ) : (
                      <>
                        <p>
                          {m.conducao.viagens} viagem(ns) · {m.conducao.km.toLocaleString("pt-BR")} km
                        </p>
                        <p className={m.conducao.excessos > 0 ? "font-medium text-amber-700" : ""}>
                          máx. {m.conducao.velocidadeMax ?? "—"} km/h
                          {m.conducao.excessos > 0 && ` · ${m.conducao.excessos} acima de ${SPEED_LIMIT_KMH}`}
                        </p>
                        {m.conducao.ociosoMin > 0 && <p className="text-slate-400">{m.conducao.ociosoMin} min ocioso</p>}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {m.ponto.interjornada === 0 && m.ponto.diasLongos === 0 ? (
                      "—"
                    ) : (
                      <>
                        {m.ponto.interjornada > 0 && <p className="font-medium text-amber-700">{m.ponto.interjornada} interjornada(s)</p>}
                        {m.ponto.diasLongos > 0 && <p>{m.ponto.diasLongos} dia(s) longo(s)</p>}
                      </>
                    )}
                    {m.ponto.regime12x36 && <p className="text-slate-400">regime 12x36</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{m.faltas > 0 ? <span className="font-medium text-amber-700">{m.faltas}</span> : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/utilizacao/auditoria?driverId=${m.driverId}`}
                      title="Auditoria do dia desse motorista"
                      className="inline-flex items-center rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <SearchCheck className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>
            {comSinal.length} motorista(s) com algum sinal · {semSinal} sem nenhum sinal no período
          </span>
          <Link href={`/risco?dias=${dias}${mostrarTodos ? "" : "&todos=1"}`} className="font-medium text-blue-700 hover:underline">
            {mostrarTodos ? "Esconder quem não tem sinal" : "Mostrar todos"}
          </Link>
        </div>
      </div>

      <div className={`${cardClass} mt-4 text-xs text-slate-500`}>
        <p className="mb-1 font-medium text-slate-700">Como o ranking é montado</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            <Gavel className="mr-1 inline h-3 w-3" />
            Multas e pontos: só as atribuídas a um motorista em Multas (indicação sugerida, selecionada, enviada ou validada). Não é o
            prontuário do DETRAN — a LW não expõe isso.
          </li>
          <li>
            <Gauge className="mr-1 inline h-3 w-3" />
            Condução: viagens da Ituran atribuídas pela escala do SIAT do mesmo veículo no mesmo dia. Viagem sem escala fica de fora
            (o total aparece no card acima). Limite genérico de {SPEED_LIMIT_KMH} km/h.
          </li>
          <li>
            <AlarmClockOff className="mr-1 inline h-3 w-3" />
            Ponto: descanso entre turnos abaixo de 11h (36h em 12x36) e dias acima de 10h trabalhadas. O detalhe legal completo
            continua em Análise de riscos.
          </li>
          <li>Faltas: dia com escala no SIAT e nenhum ponto batido, descontando afastamentos.</li>
          <li>Score: soma ponderada dos motivos listados em cada linha — ordena quem olhar primeiro, não substitui a análise humana.</li>
        </ul>
      </div>
    </div>
  );
}
