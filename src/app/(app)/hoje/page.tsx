import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlarmClockOff,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  CreditCard,
  Gavel,
  IdCard,
  Plug,
  Satellite,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { requireRole } from "@/lib/auth";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { buildHoje, MULTAS_PRAZO_JANELA_DIAS } from "@/lib/hoje";

function formatBRL(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Tone = "critical" | "warning" | "good" | "neutral";
const TONE_BADGE: Record<Tone, string> = {
  critical: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  good: "bg-emerald-100 text-emerald-700",
  neutral: "bg-slate-100 text-slate-600",
};

function Section({
  icon: Icon,
  title,
  count,
  tone,
  href,
  hrefLabel,
  emptyText,
  children,
  footer,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  count: number;
  tone: Tone;
  href: string;
  hrefLabel: string;
  emptyText: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const vazio = count === 0;
  return (
    <section className={`${cardClass} flex flex-col`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <span className={`${badgeClass} ${vazio ? TONE_BADGE.good : TONE_BADGE[tone]}`}>{count}</span>
        </div>
        <Link href={href} prefetch={false} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
          {hrefLabel} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {vazio ? (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <ShieldCheck className="h-4 w-4 shrink-0" /> {emptyText}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">{children}</ul>
      )}
      {footer && <div className="mt-3 text-xs text-slate-500">{footer}</div>}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <li className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">{children}</li>;
}

function Tile({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone: Tone }) {
  return (
    <div className={cardClass}>
      <p className={`text-2xl font-semibold ${tone === "critical" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-slate-900"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default async function HojePage() {
  const session = await requireRole("ADMIN", "GESTOR");
  const hoje = await buildHoje(session.companyId);
  const ontemISO = format(hoje.ontemLabel, "yyyy-MM-dd");
  const dataExtenso = format(hoje.hojeLabel, "EEEE, d 'de' MMMM", { locale: ptBR });
  const tudoEmDia = hoje.urgentes === 0 && hoje.avisos === 0;

  return (
    <div>
      <PageHeader
        title="Hoje"
        subtitle={`${dataExtenso.charAt(0).toUpperCase()}${dataExtenso.slice(1)} — o que precisa de decisão agora, reunido de todos os módulos.`}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Urgentes" value={hoje.urgentes} sub="prazo de multa e CNH vencida" tone={hoje.urgentes > 0 ? "critical" : "good"} />
        <Tile label="Avisos" value={hoje.avisos} sub="divergências, cartões, integrações, manutenção" tone={hoje.avisos > 0 ? "warning" : "good"} />
        <Tile
          label="Escalas hoje"
          value={hoje.resumo.escalasHoje}
          sub={`${hoje.resumo.motoristasEscalados} motorista(s) · ${hoje.resumo.veiculosEscalados} veículo(s)`}
          tone="neutral"
        />
        <Tile label="Motoristas afastados hoje" value={hoje.afastadosHoje.length} sub="férias, atestado, folga ou abono" tone="neutral" />
      </div>

      {tudoEmDia && (
        <div className={`${cardClass} mb-6 flex items-center gap-3 border-emerald-200 bg-emerald-50 text-emerald-800`}>
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">Tudo em dia — nenhuma pendência que precise de decisão hoje.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section
          icon={Gavel}
          title={`Multas — prazo de indicação em até ${MULTAS_PRAZO_JANELA_DIAS} dias`}
          count={hoje.multas.vencendo}
          tone="critical"
          href="/multas?sort=dataLimiteIndicacao&dir=asc"
          hrefLabel="Ver multas"
          emptyText="Nenhuma multa com prazo de indicação vencendo."
          footer={
            hoje.multas.vencidas > 0 ? (
              <span>
                {hoje.multas.vencidas} multa(s) já com prazo vencido sem indicação enviada — não dá mais pra indicar na LW, só
                acompanhar.
              </span>
            ) : undefined
          }
        >
          {hoje.multas.itens.map((m) => (
            <Row key={m.id}>
              <div>
                <p className="text-sm font-medium text-slate-800">
                  <span className="font-mono">{m.placa}</span>
                  {m.ait && <span className="text-slate-400"> · AIT {m.ait}</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {formatBRL(m.valorCents)} ·{" "}
                  {m.condutorSugerido ? (
                    <>
                      condutor {m.status === "SUGERIDA" ? "sugerido" : "selecionado"}: {m.condutorSugerido}
                    </>
                  ) : (
                    <span className="text-amber-700">sem condutor definido</span>
                  )}
                </p>
              </div>
              <span className={`${badgeClass} shrink-0 ${m.diasRestantes <= 2 ? TONE_BADGE.critical : TONE_BADGE.warning}`}>
                {m.diasRestantes === 0 ? "Vence hoje" : `Vence em ${m.diasRestantes}d`} · {format(m.dataLimiteIndicacao, "dd/MM")}
              </span>
            </Row>
          ))}
        </Section>

        <Section
          icon={IdCard}
          title="CNH vencida ou vencendo em 30 dias"
          count={hoje.cnh.vencidas + hoje.cnh.venceEmBreve}
          tone={hoje.cnh.vencidas > 0 ? "critical" : "warning"}
          href="/cadastros/motoristas?status=ativo&cnhStatus=vencida"
          hrefLabel="Ver motoristas"
          emptyText="Nenhuma CNH vencida ou próxima do vencimento."
          footer={
            hoje.cnh.vencidas + hoje.cnh.venceEmBreve > hoje.cnh.itens.length ? (
              <span>Mostrando os {hoje.cnh.itens.length} mais urgentes de {hoje.cnh.vencidas + hoje.cnh.venceEmBreve}.</span>
            ) : undefined
          }
        >
          {hoje.cnh.itens.map((c) => (
            <Row key={c.driverId}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{c.driverName}</p>
                <p className="text-xs text-slate-500">
                  CNH {c.cnhCategory ?? "—"}
                  {c.cnhExpiration && ` · vence em ${format(c.cnhExpiration, "dd/MM/yyyy")}`}
                </p>
                {c.proximaViagem && (
                  <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    Viagem em {format(c.proximaViagem.date, "dd/MM")} às {c.proximaViagem.startTime}
                    {c.proximaViagem.clientName ? ` (${c.proximaViagem.clientName})` : ""} —{" "}
                    {c.substitutos.length > 0
                      ? `livre(s) nesse dia: ${c.substitutos.map((s) => s.driverName).join(", ")}`
                      : "nenhum substituto da mesma categoria livre"}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className={`${badgeClass} ${c.nivel === "vencida" ? TONE_BADGE.critical : TONE_BADGE.warning}`}>
                  {c.nivel === "vencida" ? `Vencida há ${Math.abs(c.diasParaVencer ?? 0)}d` : `Vence em ${c.diasParaVencer}d`}
                </span>
                {c.afastamento && <span className={`${badgeClass} ${TONE_BADGE.neutral}`}>{c.afastamento}</span>}
              </div>
            </Row>
          ))}
        </Section>

        <Section
          icon={AlarmClockOff}
          title={`Escala x ponto de ontem (${format(hoje.ontemLabel, "dd/MM")})`}
          count={hoje.excecoesOntem.semAfastamento}
          tone="warning"
          href={`/utilizacao/auditoria/excecoes?data=${ontemISO}`}
          hrefLabel="Ver exceções"
          emptyText="Escala e ponto batem pra todo mundo ontem."
          footer={
            hoje.excecoesOntem.total > hoje.excecoesOntem.semAfastamento ? (
              <span>{hoje.excecoesOntem.total - hoje.excecoesOntem.semAfastamento} outro(s) explicado(s) por afastamento.</span>
            ) : undefined
          }
        >
          {hoje.excecoesOntem.itens
            .filter((e) => !e.afastamento)
            .map((e) => (
              <Row key={e.driverId}>
                <div>
                  <p className="text-sm font-medium text-slate-800">{e.driverName}</p>
                  <p className="text-xs text-amber-700">
                    {e.tipo === "escala_sem_ponto" ? "Escala no SIAT sem ponto batido" : "Ponto batido sem escala no SIAT"}
                  </p>
                </div>
                <Link
                  href={`/utilizacao/auditoria?driverId=${e.driverId}&data=${ontemISO}`}
                  className="shrink-0 text-xs font-medium text-blue-700 hover:underline"
                >
                  Auditar
                </Link>
              </Row>
            ))}
        </Section>

        <Section
          icon={Satellite}
          title={`Escalado ontem, sem viagem na Ituran (${format(hoje.ontemLabel, "dd/MM")})`}
          count={hoje.escalaSemViagem.total}
          tone="warning"
          href={`/telemetria/viagens?dateFrom=${ontemISO}&dateTo=${ontemISO}`}
          hrefLabel="Ver viagens"
          emptyText={
            hoje.escalaSemViagem.ituranSemDadosOntem
              ? "A Ituran não trouxe nenhuma viagem ontem — provável falha de sincronização (veja Integrações), não ausência real."
              : "Todo veículo escalado ontem rodou de verdade."
          }
          footer={
            <span>
              Veículo cadastrado recentemente pode não ter viagens sincronizadas ainda — nesse caso, reimporte o intervalo em
              Integrações antes de cobrar alguém.
            </span>
          }
        >
          {hoje.escalaSemViagem.itens.map((v) => (
            <Row key={v.vehicleId}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  <span className="font-mono">{v.plate}</span>
                  <span className="text-slate-400"> · {v.escalas} escala(s)</span>
                </p>
                <p className="truncate text-xs text-slate-500">
                  {v.motoristas.join(", ")}
                  {v.clientes.length > 0 && ` · ${v.clientes.join(", ")}`}
                </p>
              </div>
              <Link
                href={`/utilizacao/auditoria?driverId=${v.driverId}&vehicleId=${v.vehicleId}&data=${ontemISO}`}
                className="shrink-0 text-xs font-medium text-blue-700 hover:underline"
              >
                Auditar
              </Link>
            </Row>
          ))}
        </Section>

        <Section
          icon={CreditCard}
          title="Cartões de combustível bloqueados ou com saldo baixo"
          count={hoje.cartoes.length}
          tone="warning"
          href="/combustivel/cartoes"
          hrefLabel="Ver cartões"
          emptyText="Nenhum cartão bloqueado nem abaixo de 10% do limite."
        >
          {hoje.cartoes.map((c) => (
            <Row key={c.numeroCartao}>
              <div>
                <p className="text-sm font-medium text-slate-800">
                  <span className="font-mono">{c.plate}</span>
                  <span className="text-slate-400"> · cartão {c.numeroCartao}</span>
                </p>
                <p className="text-xs text-slate-500">
                  Saldo {formatBRL(c.saldoCents)} de {formatBRL(c.limiteCents)}
                </p>
              </div>
              <span className={`${badgeClass} shrink-0 ${c.situacao === "bloqueado" ? TONE_BADGE.critical : TONE_BADGE.warning}`}>
                {c.situacao === "bloqueado" ? "Bloqueado" : "Saldo baixo"}
              </span>
            </Row>
          ))}
        </Section>

        <Section
          icon={Plug}
          title="Integrações sem dados"
          count={hoje.integracoes.length}
          tone="warning"
          href="/integracoes"
          hrefLabel="Ver integrações"
          emptyText="Todas as integrações trouxeram dados nos últimos dias."
        >
          {hoje.integracoes.map((i) => (
            <Row key={i.sistema}>
              <div>
                <p className="text-sm font-medium text-slate-800">{i.sistema}</p>
                <p className="text-xs text-slate-500">
                  Sem dados em {i.missingDays.map((d) => format(new Date(`${d}T12:00:00`), "dd/MM")).join(", ")}
                  {i.lastDate && ` · último registro ${format(i.lastDate, "dd/MM")}`}
                </p>
              </div>
              <span className={`${badgeClass} shrink-0 ${TONE_BADGE.warning}`}>{i.missingDays.length} dia(s)</span>
            </Row>
          ))}
        </Section>

        <Section
          icon={Wrench}
          title="Manutenção preventiva pendente"
          count={hoje.manutencao.length}
          tone="warning"
          href="/utilizacao"
          hrefLabel="Registrar manutenção"
          emptyText="Nenhum veículo passou do intervalo de manutenção."
          footer={<span>Hodômetro atualizado automaticamente pela Ituran a cada leitura.</span>}
        >
          {hoje.manutencao.map((v) => (
            <Row key={v.vehicleId}>
              <p className="text-sm font-medium text-slate-800">
                <span className="font-mono">{v.plate}</span>
              </p>
              <span className={`${badgeClass} shrink-0 ${TONE_BADGE.warning}`}>
                {v.kmDesde.toLocaleString("pt-BR")} km desde a última
              </span>
            </Row>
          ))}
        </Section>

        <Section
          icon={CalendarOff}
          title="Motoristas afastados hoje"
          count={hoje.afastadosHoje.length}
          tone="neutral"
          href="/afastamentos"
          hrefLabel="Ver afastamentos"
          emptyText="Nenhum motorista afastado hoje."
        >
          {hoje.afastadosHoje.map((a) => (
            <Row key={`${a.driverName}-${a.tipo}`}>
              <p className="text-sm font-medium text-slate-800">{a.driverName}</p>
              <span className={`${badgeClass} shrink-0 ${TONE_BADGE.neutral}`}>
                {a.tipo} · até {format(a.ate, "dd/MM")}
              </span>
            </Row>
          ))}
        </Section>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
        <CalendarDays className="h-3.5 w-3.5" />
        Cada bloco usa exatamente o mesmo cálculo da tela de origem — o número aqui e lá nunca discordam.
        <AlertTriangle className="ml-2 h-3.5 w-3.5" />
        Ontem é o último dia fechado: os robôs buscam D-1 de madrugada.
      </p>
    </div>
  );
}
