import Link from "next/link";
import { format } from "date-fns";
import { AlertTriangle, ArrowRight, CalendarClock, ClipboardList, Gauge, ShieldCheck, Wrench } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { isSofitAvailable } from "@/lib/sofit/client";
import {
  APROVACAO_ATRASADA_DIAS,
  BACKLOG_ANTIGO_DIAS,
  buildManutencao,
  DISPONIBILIDADE_LABEL,
  OS_STATUS_LABEL,
  OS_TIPO_LABEL,
  VENCIMENTO_JANELA_DIAS,
  type AderenciaVeiculo,
} from "@/lib/manutencao";

const TH = "px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500";
const TD = "px-4 py-2 text-slate-700";
const NUM = "text-right tabular-nums";

const SITUACAO: Record<AderenciaVeiculo["situacao"], { label: string; cls: string }> = {
  vencida: { label: "Vencida", cls: "bg-red-100 text-red-700" },
  breve: { label: "Vence em breve", cls: "bg-amber-100 text-amber-700" },
  em_dia: { label: "Em dia", cls: "bg-emerald-100 text-emerald-700" },
  sem_historico: { label: "Sem histórico", cls: "bg-slate-100 text-slate-500" },
};

function Tile({ icon: Icon, label, value, sub, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; sub?: string; tone: "critical" | "warning" | "good" | "neutral" }) {
  const cls = { critical: "bg-red-100 text-red-700", warning: "bg-amber-100 text-amber-700", good: "bg-emerald-100 text-emerald-700", neutral: "bg-slate-100 text-slate-600" }[tone];
  return (
    <div className={cardClass}>
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${cls}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function num(n: number, d = 0) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: d });
}

export default async function ManutencaoPage({ searchParams }: { searchParams: Promise<{ status?: string; todos?: string }> }) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { status: statusFiltro, todos } = await searchParams;
  const available = isSofitAvailable();
  const m = await buildManutencao(session.companyId);
  const semDados = m.ultimaSync == null;

  const backlogFiltrado = statusFiltro ? m.backlog.itens.filter((o) => o.status === statusFiltro) : m.backlog.itens;
  const backlogVisivel = todos === "1" ? backlogFiltrado : backlogFiltrado.slice(0, 40);
  const mesAtual = m.mensal[m.mensal.length - 1];
  const pctPrev = mesAtual && mesAtual.total > 0 ? Math.round((mesAtual.preventivas / mesAtual.total) * 100) : null;
  const aderVisivel = todos === "1" ? m.aderencia.itens : m.aderencia.itens.slice(0, 40);
  const cobrancas = [
    m.higiene.osAntigas > 0 && `${m.higiene.osAntigas} OS "em andamento" há mais de ${BACKLOG_ANTIGO_DIAS} dias — provavelmente feitas e não fechadas na Sofit.`,
    m.higiene.aprovacaoAtrasada > 0 && `${m.higiene.aprovacaoAtrasada} preventiva(s) geradas pelo plano aguardando aprovação há mais de ${APROVACAO_ATRASADA_DIAS} dias — o plano existe e está travado por falta de aprovação.`,
    m.higiene.paradosSemOs > 0 && `${m.higiene.paradosSemOs} veículo(s) marcados "em manutenção" sem nenhuma OS aberta — status desatualizado ou OS não aberta.`,
    m.higiene.osSemVeiculo > 0 && `${m.higiene.osSemVeiculo} OS aberta(s) cujo veículo não bate com o nosso cadastro (placa diferente ou veículo baixado).`,
    m.higiene.vencimentosAntigos > 0 && `${m.higiene.vencimentosAntigos} vencimento(s) sem recorrência com data de mais de 1 ano atrás nunca baixados na Sofit.`,
  ].filter((x): x is string => Boolean(x));

  return (
    <div>
      <PageHeader
        title="Manutenção"
        subtitle="Visão executiva da Sofit: frota disponível, fila de ordens de serviço, preventiva × corretiva, aderência ao plano, reincidência e vencimentos legais."
        extra={
          <div className="flex items-center gap-3">
            <Link href="/manutencao/auditoria" className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100">
              <AlertTriangle className="h-3.5 w-3.5" /> Auditoria de dados da Sofit
            </Link>
            <Link href="/integracoes" className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
              {m.ultimaSync ? `Sincronizado ${format(m.ultimaSync, "dd/MM HH:mm")}` : "Nunca sincronizado"} · Integrações <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        }
      />

      {!available && (
        <div className={`${cardClass} mb-6 flex items-start gap-3 border-amber-200 bg-amber-50`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">Sofit não configurada (SOFIT_API_URL/SOFIT_TOKEN) — esta tela mostra só o que já foi importado.</p>
        </div>
      )}
      {semDados && available && (
        <div className={`${cardClass} mb-6 flex items-start gap-3 border-amber-200 bg-amber-50`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            Nenhuma ordem de serviço importada ainda. Em <Link href="/integracoes" className="font-medium underline">Integrações</Link>, clique em
            &quot;Sincronizar manutenção&quot; (a primeira carga traz o histórico inteiro) — ou espere o robô da madrugada.
          </p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Tile icon={ShieldCheck} label="Disponíveis agora" value={m.frota.disponiveis} sub={`de ${m.frota.total} ativos na Sofit`} tone="good" />
        <Tile icon={Wrench} label="Em manutenção agora" value={m.frota.emManutencao} sub={`${m.higiene.paradosSemOs} sem OS aberta`} tone={m.frota.emManutencao > 0 ? "warning" : "good"} />
        <Tile icon={ClipboardList} label="OS abertas" value={m.backlog.total} sub={`${m.backlog.antigas} há mais de ${BACKLOG_ANTIGO_DIAS} dias`} tone={m.backlog.antigas > 0 ? "critical" : "neutral"} />
        <Tile icon={Gauge} label="Preventiva no mês" value={pctPrev == null ? "—" : `${pctPrev}%`} sub={mesAtual ? `${mesAtual.preventivas} de ${mesAtual.total} OS` : undefined} tone={pctPrev != null && pctPrev < 30 ? "warning" : "neutral"} />
        <Tile icon={AlertTriangle} label="Plano vencido" value={m.aderencia.vencidas} sub={`${m.aderencia.breve} vencem em breve · ${m.aderencia.semHistorico} sem histórico`} tone={m.aderencia.vencidas > 0 ? "critical" : "good"} />
        <Tile icon={CalendarClock} label={`Vencimentos em ${VENCIMENTO_JANELA_DIAS} dias`} value={m.vencimentos.proximos.length} sub={`${m.vencimentos.vencidos.length} já vencido(s)`} tone={m.vencimentos.vencidos.length > 0 ? "critical" : m.vencimentos.proximos.length > 0 ? "warning" : "good"} />
      </div>

      {cobrancas.length > 0 && (
        <section className={`${cardClass} mb-6 border-amber-200`}>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Para cobrar da equipe — o que está fora da realidade na Sofit</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {cobrancas.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className={`${cardClass} p-0 overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Veículos parados agora (status da Sofit)</h2>
            <span className={`${badgeClass} ${m.parados.length > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{m.parados.length}</span>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className={TH}>Veículo</th>
                  <th className={TH}>OS aberta</th>
                  <th className={`${TH} ${NUM}`}>Dias</th>
                </tr>
              </thead>
              <tbody>
                {m.parados.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">Nenhum veículo marcado em manutenção.</td>
                  </tr>
                )}
                {m.parados.map((p) => (
                  <tr key={p.plate} className="border-t border-slate-100">
                    <td className={TD}>
                      <span className="font-mono font-medium">{p.plate}</span> <span className="text-xs text-slate-500">{p.modelo}</span>
                    </td>
                    <td className={`${TD} text-xs`}>
                      {p.osAberta ? (
                        <>
                          <span className="font-medium">{p.osAberta.numero}</span> · {OS_TIPO_LABEL[p.osAberta.tipo ?? ""] ?? p.osAberta.tipo} · {OS_STATUS_LABEL[p.osAberta.status ?? ""] ?? p.osAberta.status}
                          {p.osAberta.problema && <span className="block truncate text-slate-500" title={p.osAberta.problema}>{p.osAberta.problema.split("\n")[0]}</span>}
                        </>
                      ) : (
                        <span className={`${badgeClass} bg-red-100 text-red-700`}>sem OS aberta</span>
                      )}
                    </td>
                    <td className={`${TD} ${NUM} ${p.osAberta && p.osAberta.idadeDias > BACKLOG_ANTIGO_DIAS ? "font-semibold text-red-700" : ""}`}>{p.osAberta ? p.osAberta.idadeDias : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${cardClass} p-0 overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Preventiva × corretiva — últimos 6 meses</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Mês</th>
                <th className={`${TH} ${NUM}`}>OS</th>
                <th className={`${TH} ${NUM}`}>Corretivas</th>
                <th className={`${TH} ${NUM}`}>Preventivas</th>
                <th className={`${TH} ${NUM}`}>% prev.</th>
                <th className={`${TH} ${NUM}`}>Externas</th>
                <th className={`${TH} ${NUM}`}>Dias parado</th>
              </tr>
            </thead>
            <tbody>
              {m.mensal.map((r) => {
                const pct = r.total > 0 ? Math.round((r.preventivas / r.total) * 100) : null;
                return (
                  <tr key={r.mes} className="border-t border-slate-100">
                    <td className={TD}>{format(new Date(`${r.mes}-15T12:00:00`), "MMM/yy")}</td>
                    <td className={`${TD} ${NUM}`}>{r.total}</td>
                    <td className={`${TD} ${NUM}`}>{r.corretivas}</td>
                    <td className={`${TD} ${NUM}`}>{r.preventivas}</td>
                    <td className={`${TD} ${NUM} ${pct != null && pct < 30 ? "text-amber-700" : ""}`}>{pct == null ? "—" : `${pct}%`}</td>
                    <td className={`${TD} ${NUM}`}>{r.externas}</td>
                    <td className={`${TD} ${NUM}`}>{num(r.diasParado)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-slate-400">
            Dias parado = soma de <em>vehicle_down_days</em> das OS abertas no mês, como a Sofit calcula ao fechar a OS. Problemas mais citados (90 dias):{" "}
            {m.termos.map((t) => `${t.termo.toLowerCase()} (${t.qtd})`).join(", ") || "—"}.
          </p>
        </section>
      </div>

      <section className={`${cardClass} mb-6 p-0 overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Causas das OS corretivas — 90 dias</h2>
            <p className="text-xs text-slate-500">
              Meta: reduzir corretiva. Corretivas por veículo ativo no mês:{" "}
              <span className="font-semibold text-slate-800">{m.corretivasPorVeiculo.mesAtual ?? "—"}</span>
              {m.corretivasPorVeiculo.mesAnterior != null && ` (mês anterior ${m.corretivasPorVeiculo.mesAnterior})`}. Onde uma causa concentra OS e dias parados, cabe inspeção/preventiva dirigida.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Causa</th>
                <th className={`${TH} ${NUM}`}>OS</th>
                <th className={`${TH} ${NUM}`}>Veículos</th>
                <th className={`${TH} ${NUM}`}>Dias parado</th>
                <th className={TH}>Veículos mais afetados</th>
              </tr>
            </thead>
            <tbody>
              {m.causas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">Sem OS corretivas no período.</td>
                </tr>
              )}
              {m.causas.map((c) => (
                <tr key={c.categoria} className="border-t border-slate-100">
                  <td className={`${TD} font-medium`}>{c.categoria}</td>
                  <td className={`${TD} ${NUM} font-semibold`}>{c.os}</td>
                  <td className={`${TD} ${NUM}`}>{c.veiculos}</td>
                  <td className={`${TD} ${NUM}`}>{num(c.diasParado)}</td>
                  <td className={`${TD} font-mono text-xs text-slate-500`}>{c.exemplos.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${cardClass} mb-6 p-0 overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Fila de ordens de serviço abertas — mais antigas primeiro</h2>
          <div className="flex flex-wrap gap-1.5">
            <Link href="/manutencao" className={`${badgeClass} ${!statusFiltro ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              Todas {m.backlog.total}
            </Link>
            {Object.entries(m.backlog.porStatus).map(([st, n]) => (
              <Link key={st} href={`/manutencao?status=${st}`} className={`${badgeClass} ${statusFiltro === st ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {OS_STATUS_LABEL[st] ?? st} {n}
              </Link>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>OS</th>
                <th className={TH}>Veículo</th>
                <th className={TH}>Tipo</th>
                <th className={TH}>Status</th>
                <th className={`${TH} ${NUM}`}>Aberta há</th>
                <th className={TH}>Previsão</th>
                <th className={TH}>Problema</th>
                <th className={TH}>Fornecedor</th>
              </tr>
            </thead>
            <tbody>
              {backlogVisivel.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-sm text-emerald-700">Nenhuma OS aberta.</td>
                </tr>
              )}
              {backlogVisivel.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className={`${TD} font-medium`}>{o.numero}</td>
                  <td className={`${TD} font-mono text-xs`}>{o.plate ?? "—"}</td>
                  <td className={`${TD} text-xs`}>{OS_TIPO_LABEL[o.tipo ?? ""] ?? o.tipo ?? "—"}</td>
                  <td className={`${TD} text-xs`}>{OS_STATUS_LABEL[o.status ?? ""] ?? o.status}</td>
                  <td className={`${TD} ${NUM} ${o.idadeDias > BACKLOG_ANTIGO_DIAS ? "font-semibold text-red-700" : ""}`}>{o.idadeDias}d</td>
                  <td className={`${TD} text-xs ${o.previsaoFimEm && o.previsaoFimEm < new Date() ? "text-red-700" : "text-slate-500"}`}>{o.previsaoFimEm ? format(o.previsaoFimEm, "dd/MM") : "—"}</td>
                  <td className={`${TD} max-w-[320px] truncate text-xs`} title={o.problema ?? undefined}>{o.problema?.split("\n")[0] ?? "—"}</td>
                  <td className={`${TD} text-xs text-slate-500`}>{o.fornecedor ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {backlogFiltrado.length > backlogVisivel.length && (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Mostrando {backlogVisivel.length} de {backlogFiltrado.length}.{" "}
            <Link href={`/manutencao?${statusFiltro ? `status=${statusFiltro}&` : ""}todos=1`} className="font-medium text-blue-700 hover:underline">Mostrar todas</Link>
          </p>
        )}
      </section>

      <section className={`${cardClass} mb-6 p-0 overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Aderência ao plano de manutenção (intervalo de cada veículo na Sofit)</h2>
          <span className="text-xs text-slate-500">
            {m.aderencia.vencidas} vencida(s) · {m.aderencia.breve} em breve · {m.aderencia.emDia} em dia · {m.aderencia.semHistorico} sem histórico
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Veículo</th>
                <th className={`${TH} ${NUM}`}>Km atual</th>
                <th className={TH}>Última revisão</th>
                <th className={`${TH} ${NUM}`}>Km desde / intervalo</th>
                <th className={`${TH} ${NUM}`}>Dias desde / intervalo</th>
                <th className={TH}>Situação</th>
                <th className={TH}>Agora</th>
              </tr>
            </thead>
            <tbody>
              {aderVisivel.map((a) => (
                <tr key={a.vehicleId} className="border-t border-slate-100">
                  <td className={TD}>
                    <span className="font-mono font-medium">{a.plate}</span> <span className="text-xs text-slate-500">{a.modelo}</span>
                  </td>
                  <td className={`${TD} ${NUM}`}>{num(a.kmAtual)}</td>
                  <td className={`${TD} text-xs`}>{a.ultimaEm ? `${format(a.ultimaEm, "dd/MM/yy")}${a.ultimaKm ? ` · ${num(a.ultimaKm)} km` : ""}` : "—"}</td>
                  <td className={`${TD} ${NUM}`}>{a.kmDesde != null ? `${num(a.kmDesde)} / ${num(a.intervaloKm)}` : `— / ${num(a.intervaloKm)}`}</td>
                  <td className={`${TD} ${NUM}`}>{a.diasDesde != null ? `${a.diasDesde} / ${a.intervaloDias ?? "—"}` : `— / ${a.intervaloDias ?? "—"}`}</td>
                  <td className={TD}>
                    <span className={`${badgeClass} ${SITUACAO[a.situacao].cls}`}>
                      {SITUACAO[a.situacao].label}
                      {a.pct != null && a.situacao !== "sem_historico" && ` · ${Math.round(a.pct * 100)}%`}
                    </span>
                  </td>
                  <td className={`${TD} text-xs text-slate-500`}>{DISPONIBILIDADE_LABEL[a.disponibilidade ?? ""] ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {m.aderencia.itens.length > aderVisivel.length && (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Mostrando {aderVisivel.length} de {m.aderencia.itens.length}. <Link href="/manutencao?todos=1" className="font-medium text-blue-700 hover:underline">Mostrar todos</Link>
          </p>
        )}
      </section>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className={`${cardClass} p-0 overflow-hidden`}>
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Veículos reincidentes — 3+ OS em 90 dias</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Veículo</th>
                <th className={`${TH} ${NUM}`}>OS</th>
                <th className={`${TH} ${NUM}`}>Dias parado</th>
                <th className={TH}>Problemas</th>
              </tr>
            </thead>
            <tbody>
              {m.reincidentes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">Nenhum veículo com 3+ OS no período.</td>
                </tr>
              )}
              {m.reincidentes.map((r) => (
                <tr key={r.plate} className="border-t border-slate-100 align-top">
                  <td className={`${TD} font-mono font-medium`}>{r.plate}</td>
                  <td className={`${TD} ${NUM} font-semibold`}>{r.os}</td>
                  <td className={`${TD} ${NUM}`}>{num(r.diasParado)}</td>
                  <td className={`${TD} text-xs text-slate-500`}>{r.problemas.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={`${cardClass} p-0 overflow-hidden`}>
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Fornecedores — 90 dias</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Fornecedor</th>
                <th className={`${TH} ${NUM}`}>OS</th>
                <th className={`${TH} ${NUM}`}>Dias parado (média)</th>
              </tr>
            </thead>
            <tbody>
              {m.fornecedores.map((f) => (
                <tr key={f.nome} className="border-t border-slate-100">
                  <td className={TD}>{f.nome}</td>
                  <td className={`${TD} ${NUM}`}>{f.os}</td>
                  <td className={`${TD} ${NUM}`}>{f.diasParadoMedio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className={`${cardClass} mb-6 p-0 overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Vencimentos legais — vencidos e próximos {VENCIMENTO_JANELA_DIAS} dias</h2>
          <span className="text-xs text-slate-500">IPVA, licenciamento, DPVAT, seguro, tacógrafo, extintor, CVS — conforme cadastro na Sofit</span>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className={TH}>Veículo</th>
                <th className={TH}>Vencimento</th>
                <th className={TH}>Data</th>
                <th className={`${TH} ${NUM}`}>Prazo</th>
              </tr>
            </thead>
            <tbody>
              {m.vencimentos.vencidos.length + m.vencimentos.proximos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-emerald-700">Nada vencido nem vencendo nos próximos {VENCIMENTO_JANELA_DIAS} dias.</td>
                </tr>
              )}
              {[...m.vencimentos.vencidos, ...m.vencimentos.proximos].map((v, i) => (
                <tr key={`${v.plate}-${v.tipo}-${i}`} className="border-t border-slate-100">
                  <td className={`${TD} font-mono font-medium`}>{v.plate}</td>
                  <td className={TD}>{v.tipo}</td>
                  <td className={`${TD} text-xs`}>{format(v.venceEm, "dd/MM/yyyy")}</td>
                  <td className={`${TD} ${NUM}`}>
                    <span className={`${badgeClass} ${v.dias < 0 ? "bg-red-100 text-red-700" : v.dias <= 15 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                      {v.dias < 0 ? `vencido há ${Math.abs(v.dias)}d` : v.dias === 0 ? "vence hoje" : `em ${v.dias}d`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className={`${cardClass} text-xs text-slate-500`}>
        <p className="mb-1 font-medium text-slate-700">De onde vem cada número</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Tudo é espelho da Sofit (ordens de serviço, cadastro de veículos com disponibilidade e intervalo, vencimentos), sincronizado toda madrugada e pelo botão em Integrações. Se a Sofit está desatualizada, isto aqui mostra a desatualização — é o ponto.</li>
          <li>&quot;Última revisão&quot; = última OS concluída preventiva ou com descrição de revisão/troca de óleo, com o hodômetro que a oficina registrou no fechamento. Km atual = o maior entre Ituran e Sofit.</li>
          <li>Custo por OS não aparece porque a Sofit da empresa não tem custo lançado nas OS (quase tudo R$ 0) — dado que falta lançar lá, não integrar aqui.</li>
        </ul>
      </div>
    </div>
  );
}
