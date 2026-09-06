import Link from "next/link";
import { format, differenceInCalendarDays } from "date-fns";
import { AlertTriangle, IdCard, Landmark, SearchCheck, ShieldCheck, UserX } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import { cnhAlertLevel, daysUntil, requiresCnh } from "@/lib/driverAlerts";
import { buildCnhVigia } from "@/lib/cnhVigia";
import { isTiqueTaqueAvailable, fetchAllEmployees } from "@/lib/tiquetaque/client";
import { normalizeCpf } from "@/lib/cpf";

const SEM_PONTO_LIMIAR_DIAS = 30;

const LEAVE_LABELS: Record<string, string> = {
  folga: "Folga",
  atestado: "Atestado",
  ferias: "Férias",
  abono: "Abono",
};

export default async function DashboardPage() {
  const session = await requireRole("ADMIN", "GESTOR");
  const now = new Date();

  const [drivers, sindicatos, afastamentosAtivos] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId: session.companyId },
      include: { sindicato: true },
      orderBy: { cnhExpiration: { sort: "asc", nulls: "last" } },
    }),
    prisma.sindicato.findMany({
      where: { companyId: session.companyId, active: true },
      include: { _count: { select: { drivers: true } } },
      orderBy: { nome: "asc" },
    }),
    // Cruza com afastamento do TiqueTaque valido HOJE — motorista com CNH
    // vencida mas de ferias/atestado nao e a mesma urgencia de quem esta
    // trabalhando normalmente sem CNH valida.
    prisma.driverLeave.findMany({
      where: { companyId: session.companyId, startDate: { lte: now }, endDate: { gte: now } },
      select: { driverId: true, leaveType: true, endDate: true },
    }),
  ]);
  const afastamentoByDriverId = new Map(afastamentosAtivos.map((a) => [a.driverId, a]));

  const activeDrivers = drivers.filter((d) => d.active);
  // "Motoristas ativos" e os cards de CNH so fazem sentido pra quem
  // realmente dirige — desde que o import do TiqueTaque passou a trazer
  // todos os funcionarios (nao so motoristas), precisa filtrar por cargo
  // aqui tambem, ou a contagem passaria a incluir RH/financeiro/etc.
  const activeMotoristas = activeDrivers.filter((d) => requiresCnh(d.funcao, d.departamento));
  const alerts = activeMotoristas
    .map((d) => ({ driver: d, level: cnhAlertLevel(d.cnhExpiration, d.funcao, d.departamento) }))
    .filter((a) => a.level !== "ok" && a.level !== "nao_aplicavel")
    .sort((a, b) => (a.driver.cnhExpiration?.getTime() ?? Infinity) - (b.driver.cnhExpiration?.getTime() ?? Infinity));

  const expired = alerts.filter((a) => a.level === "vencida").length;
  const dueSoon = alerts.filter((a) => a.level === "vence_em_breve").length;
  const pending = alerts.filter((a) => a.level === "pendente").length;

  const semSindicato = activeMotoristas.filter((d) => !d.sindicatoId).length;

  const vigiaCnh = await buildCnhVigia(session.companyId);
  const vigiaByDriverId = new Map(vigiaCnh.map((v) => [v.driverId, v]));

  const alertDriverIds = alerts.map((a) => a.driver.id);

  // Ultima batida de ponto de cada motorista com alerta de CNH — motorista
  // que ja nao bate ponto ha muito tempo (e nao esta de ferias/afastado, ja
  // cruzado acima) pode nem estar mais trabalhando de verdade, entao
  // renovar a CNH talvez nem seja a prioridade real.
  const ultimaBatida =
    alertDriverIds.length > 0
      ? await prisma.timeClockEntry.groupBy({
          by: ["driverId"],
          where: { companyId: session.companyId, driverId: { in: alertDriverIds } },
          _max: { date: true },
        })
      : [];
  const ultimaBatidaByDriverId = new Map(ultimaBatida.map((u) => [u.driverId, u._max.date]));

  // Status no TiqueTaque nao e sincronizado pelo cron automatico (so um
  // botao manual em Motoristas atualiza Driver.active a partir de la) —
  // pra nao depender de alguem lembrar de clicar, confere direto na API
  // aqui, ao vivo, sempre que a chave estiver configurada. So 1-2 chamadas
  // (a lista inteira de funcionarios, paginada), nao uma por motorista —
  // best-effort: se a API falhar/demorar, o Painel continua funcionando
  // normal, so sem esse cruzamento.
  let tiquetaqueByDriverId = new Map<string, "inativo" | "nao_encontrado">();
  if (isTiqueTaqueAvailable() && alertDriverIds.length > 0) {
    try {
      const funcionarios = await fetchAllEmployees();
      const empregadoByCpf = new Map(funcionarios.map((f) => [normalizeCpf(f.cpf), f]));
      const statusMap = new Map<string, "inativo" | "nao_encontrado">();
      for (const a of alerts) {
        const emp = empregadoByCpf.get(normalizeCpf(a.driver.cpf));
        if (!emp) statusMap.set(a.driver.id, "nao_encontrado");
        else if (emp.dismissed) statusMap.set(a.driver.id, "inativo");
      }
      tiquetaqueByDriverId = statusMap;
    } catch {
      // TiqueTaque fora do ar ou instavel — segue sem essa informacao em
      // vez de derrubar o Painel inteiro por causa de uma checagem extra.
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Painel</h1>
          <p className="mt-1 text-sm text-slate-500">
            Visão geral de motoristas, vínculo sindical e vencimentos de CNH.
          </p>
        </div>
        <Link
          href="/utilizacao/auditoria/excecoes"
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <SearchCheck className="h-4 w-4" />
          Exceções do dia
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard
          icon={IdCard}
          label="Motoristas ativos"
          value={activeMotoristas.length}
          tone="neutral"
        />
        <StatCard
          icon={IdCard}
          label="Funcionários ativos (todos os cargos)"
          value={activeDrivers.length}
          tone="neutral"
        />
        <StatCard
          icon={AlertTriangle}
          label="CNH vencida"
          value={expired}
          tone={expired > 0 ? "critical" : "good"}
        />
        <StatCard
          icon={AlertTriangle}
          label="CNH vence em 30 dias"
          value={dueSoon}
          tone={dueSoon > 0 ? "warning" : "good"}
        />
        <StatCard
          icon={IdCard}
          label="CNH pendente"
          value={pending}
          tone={pending > 0 ? "warning" : "good"}
        />
        <StatCard
          icon={Landmark}
          label="Sindicatos cadastrados"
          value={sindicatos.length}
          tone="neutral"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className={`${cardClass} lg:col-span-3`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Alertas de vencimento de CNH
            </h2>
            <Link href="/cadastros/motoristas" className="text-xs font-medium text-blue-700 hover:underline">
              Ver todos os motoristas
            </Link>
          </div>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Nenhuma CNH vencida ou próxima do vencimento.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {alerts.map(({ driver, level }) => {
                const days = driver.cnhExpiration ? daysUntil(driver.cnhExpiration) : null;
                const vigia = vigiaByDriverId.get(driver.id);
                const afastamento = afastamentoByDriverId.get(driver.id);
                const tiquetaqueStatus = tiquetaqueByDriverId.get(driver.id);
                const ultimaBatida = ultimaBatidaByDriverId.get(driver.id) ?? null;
                const diasSemPonto = ultimaBatida ? differenceInCalendarDays(now, ultimaBatida) : null;
                const semPontoHaMuitoTempo = !afastamento && (diasSemPonto === null || diasSemPonto > SEM_PONTO_LIMIAR_DIAS);
                return (
                  <li key={driver.id} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{driver.name}</p>
                        <p className="text-xs text-slate-500">
                          {driver.funcao ?? "Cargo não informado"} · {driver.sindicato?.nome ?? "Sem sindicato"}
                          {level === "pendente"
                            ? " · CNH não cadastrada"
                            : ` · CNH ${driver.cnhCategory} · vence em ${format(driver.cnhExpiration!, "dd/MM/yyyy")}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {/* Afastamento do TiqueTaque explica a ausencia —
                            motorista vencido mas de ferias/atestado nao tem
                            a mesma urgencia de quem esta trabalhando sem
                            CNH valida. */}
                        {afastamento && (
                          <span
                            className={`${badgeClass} bg-slate-100 text-slate-600`}
                            title={`Afastado até ${format(afastamento.endDate, "dd/MM/yyyy")}`}
                          >
                            {LEAVE_LABELS[afastamento.leaveType] ?? afastamento.leaveType}
                          </span>
                        )}
                        <span
                          className={`${badgeClass} ${
                            level === "vencida"
                              ? "bg-red-100 text-red-700"
                              : level === "pendente"
                                ? "bg-slate-100 text-slate-600"
                                : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {level === "vencida"
                            ? `Vencida há ${Math.abs(days!)}d`
                            : level === "pendente"
                              ? "Pendente"
                              : `Vence em ${days}d`}
                        </span>
                      </div>
                    </div>
                    {(tiquetaqueStatus || semPontoHaMuitoTempo) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {tiquetaqueStatus === "inativo" && (
                          <span className={`${badgeClass} bg-red-100 text-red-700`} title="Driver.active foi atualizado a partir do TiqueTaque, ou confira manualmente">
                            <UserX className="mr-1 h-3 w-3" /> Inativo no TiqueTaque
                          </span>
                        )}
                        {tiquetaqueStatus === "nao_encontrado" && (
                          <span className={`${badgeClass} bg-slate-100 text-slate-600`} title="CPF não corresponde a nenhum funcionário no TiqueTaque agora">
                            <UserX className="mr-1 h-3 w-3" /> Não encontrado no TiqueTaque
                          </span>
                        )}
                        {semPontoHaMuitoTempo && (
                          <span className={`${badgeClass} bg-amber-100 text-amber-700`}>
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            {diasSemPonto === null ? "Nunca bateu ponto" : `Sem bater ponto há ${diasSemPonto}d`}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Vigia de CNH acionavel: so mostra quando ha viagem
                        agendada no SIAT antes/depois do vencimento — vira
                        decisao urgente, nao so lembrete de renovar. */}
                    {vigia?.proximaViagem && (
                      <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <p>
                          <span className="font-medium">Tem viagem agendada</span> em{" "}
                          {format(vigia.proximaViagem.date, "dd/MM/yyyy")} às {vigia.proximaViagem.startTime}
                          {vigia.proximaViagem.clientName ? ` (${vigia.proximaViagem.clientName})` : ""} — CNH{" "}
                          {level === "vencida" ? "já vencida" : "vence antes disso"}.
                        </p>
                        {vigia.substitutos.length > 0 ? (
                          <p className="mt-1">
                            Motorista(s) categoria {driver.cnhCategory} livre(s) nesse dia:{" "}
                            {vigia.substitutos.map((s) => s.driverName).join(", ")}.
                          </p>
                        ) : (
                          <p className="mt-1">Nenhum motorista da mesma categoria livre nesse dia — precisa realocar.</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={`${cardClass} lg:col-span-2`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Motoristas por sindicato</h2>
            <Link href="/cadastros/sindicatos" className="text-xs font-medium text-blue-700 hover:underline">
              Gerenciar
            </Link>
          </div>
          <ul className="space-y-3">
            {sindicatos.map((s) => {
              const max = Math.max(...sindicatos.map((x) => x._count.drivers), 1);
              const pct = Math.round((s._count.drivers / max) * 100);
              return (
                <li key={s.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{s.nome}</span>
                    <span className="text-slate-500">{s._count.drivers}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-blue-700" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
            {semSindicato > 0 && (
              <li className="pt-1 text-xs text-slate-500">
                {semSindicato} motorista(s) sem sindicato vinculado.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: "neutral" | "good" | "warning" | "critical";
}) {
  const toneClass = {
    neutral: "bg-slate-100 text-slate-600",
    good: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    critical: "bg-red-100 text-red-700",
  }[tone];

  return (
    <div className={cardClass}>
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  );
}
