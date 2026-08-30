import Link from "next/link";
import { addMonths, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, ChevronLeft, ChevronRight, Route } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { buildViagemPontoAudit } from "@/lib/viagemPontoAudit";

export default async function AuditoriaViagemPontoPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { mes } = await searchParams;

  const anchor = mes ? new Date(`${mes}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);
  const monthEndExclusive = addMonths(monthStart, 1);
  const prevMonth = format(subMonths(monthStart, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthStart, 1), "yyyy-MM");

  const { pontoSemViagem, viagemSemPonto, escalasComPontoAbertoOuAusente } = await buildViagemPontoAudit(
    session.companyId,
    monthStart,
    monthEndExclusive
  );

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Auditoria: ponto x viagens"
        subtitle="Cruza o horário batido no ponto com o deslocamento real do veículo escalado — sinaliza ponto sem uso do veículo e viagem sem ponto correspondente."
      />

      <div className="mb-6 flex items-center gap-3">
        <Link
          href={`/telemetria/auditoria?mes=${prevMonth}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" /> Mês anterior
        </Link>
        <p className="text-sm font-medium capitalize text-slate-700">{format(monthStart, "MMMM/yyyy", { locale: ptBR })}</p>
        <Link
          href={`/telemetria/auditoria?mes=${nextMonth}`}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Próximo mês <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className={cardClass}>
          <div
            className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
              pontoSemViagem.length > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{pontoSemViagem.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Ponto batido sem viagem correspondente do veículo escalado</p>
        </div>
        <div className={cardClass}>
          <div
            className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
              viagemSemPonto.length > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            <Route className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{viagemSemPonto.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Viagens do veículo sem ponto correspondente de nenhum escalado</p>
        </div>
      </div>

      <div className={`${cardClass} mb-6 p-0 overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
          Ponto sem viagem correspondente
        </h2>
        <div className="overflow-x-auto scroll-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">Veículo</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Período batido</th>
              </tr>
            </thead>
            <tbody>
              {pontoSemViagem.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma divergência neste mês.
                  </td>
                </tr>
              )}
              {pontoSemViagem.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.driverName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.vehiclePlate}</td>
                  <td className="px-4 py-3 text-slate-600">{format(r.date, "dd/MM/yyyy")}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {format(r.pontoStart, "HH:mm")}–{format(r.pontoEnd, "HH:mm")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${cardClass} mb-6 p-0 overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
          Viagem sem ponto correspondente
        </h2>
        <div className="overflow-x-auto scroll-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Veículo</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Período da viagem</th>
                <th className="px-4 py-3">Distância</th>
              </tr>
            </thead>
            <tbody>
              {viagemSemPonto.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma divergência neste mês.
                  </td>
                </tr>
              )}
              {viagemSemPonto.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.vehiclePlate}</td>
                  <td className="px-4 py-3 text-slate-600">{format(r.tripStart, "dd/MM/yyyy")}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {format(r.tripStart, "HH:mm")}–{format(r.tripEnd, "HH:mm")}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.distanceKm != null ? `${r.distanceKm.toLocaleString("pt-BR")} km` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {escalasComPontoAbertoOuAusente > 0 && (
        <p className="mb-3 text-xs text-slate-400">
          {escalasComPontoAbertoOuAusente} escala(s) com turno de ponto ainda em aberto no período — não entram nesta
          checagem até serem encerradas.
        </p>
      )}
      <p className="text-xs text-slate-500">
        A Ituran não expõe um registro confiável de ignição ligada/desligada (o endpoint de eventos devolve só o
        último alerta de cada tipo, sem histórico paginado, e não trouxe nenhum evento de ignição ligada nos testes) —
        esta auditoria usa a viagem real do veículo (deslocamento com GPS) como aproximação, com tolerância de 30
        minutos entre o horário batido e o horário da viagem.{" "}
        <span className={`${badgeClass} bg-slate-100 text-slate-500`}>Não é aconselhamento jurídico.</span>
      </p>
    </div>
  );
}
