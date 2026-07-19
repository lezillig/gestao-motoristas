import Link from "next/link";
import { format } from "date-fns";
import { AlertTriangle, IdCard, Landmark, ShieldCheck } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import { cnhAlertLevel, daysUntil } from "@/lib/driverAlerts";

export default async function DashboardPage() {
  const session = await requireSession();

  const [drivers, sindicatos] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId: session.companyId },
      include: { sindicato: true },
      orderBy: { cnhExpiration: "asc" },
    }),
    prisma.sindicato.findMany({
      where: { companyId: session.companyId, active: true },
      include: { _count: { select: { drivers: true } } },
      orderBy: { nome: "asc" },
    }),
  ]);

  const activeDrivers = drivers.filter((d) => d.active);
  const alerts = activeDrivers
    .map((d) => ({ driver: d, level: cnhAlertLevel(d.cnhExpiration) }))
    .filter((a) => a.level !== "ok")
    .sort((a, b) => a.driver.cnhExpiration.getTime() - b.driver.cnhExpiration.getTime());

  const expired = alerts.filter((a) => a.level === "vencida").length;
  const dueSoon = alerts.filter((a) => a.level === "vence_em_breve").length;

  const semSindicato = activeDrivers.filter((d) => !d.sindicatoId).length;

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Painel</h1>
        <p className="mt-1 text-sm text-slate-500">
          Visão geral de motoristas, vínculo sindical e vencimentos de CNH.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={IdCard}
          label="Motoristas ativos"
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
                const days = daysUntil(driver.cnhExpiration);
                return (
                  <li key={driver.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{driver.name}</p>
                      <p className="text-xs text-slate-500">
                        {driver.sindicato?.nome ?? "Sem sindicato"} · CNH {driver.cnhCategory} · vence em{" "}
                        {format(driver.cnhExpiration, "dd/MM/yyyy")}
                      </p>
                    </div>
                    <span
                      className={`${badgeClass} ${
                        level === "vencida"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {level === "vencida" ? `Vencida há ${Math.abs(days)}d` : `Vence em ${days}d`}
                    </span>
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
