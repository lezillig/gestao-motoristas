import { format } from "date-fns";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { isLwAvailable } from "@/lib/lw/client";
import MultasSyncButton from "./MultasSyncButton";
import IndicacaoCell from "./IndicacaoCell";

function formatBRL(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const SITUACAO_BADGE: Record<string, string> = {
  IMPOSTO: "bg-amber-100 text-amber-800",
  NOTIFICADO: "bg-amber-100 text-amber-800",
  Encerrado: "bg-slate-100 text-slate-600",
  Cancelada: "bg-slate-100 text-slate-600",
  Devedora: "bg-red-100 text-red-700",
};

export default async function MultasPage() {
  const session = await requireRole("ADMIN", "GESTOR");
  const available = isLwAvailable();

  const [multas, drivers] = await Promise.all([
    available
      ? prisma.multa.findMany({
          where: { companyId: session.companyId },
          include: {
            vehicle: { select: { plate: true } },
            indicacao: { include: { driver: { select: { id: true, name: true, cpf: true, cnh: true } } } },
          },
          orderBy: { dataInfracao: "desc" },
        })
      : Promise.resolve([]),
    available
      ? prisma.driver.findMany({
          where: { companyId: session.companyId, active: true },
          select: { id: true, name: true, cpf: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const agora = new Date().getTime();
  const prazoVencendo = multas.filter((m) => {
    if (!m.dataLimiteIndicacao || m.indicacao?.status === "ENVIADA" || m.indicacao?.status === "VALIDADA") return false;
    const dias = (m.dataLimiteIndicacao.getTime() - agora) / 86_400_000;
    return dias <= 5;
  });

  return (
    <div>
      <PageHeader
        title="Multas"
        subtitle="Multas de trânsito da frota (LW Tecnologia) e indicação do condutor responsável."
        extra={available ? <MultasSyncButton /> : undefined}
      />

      {!available && (
        <div className={`${cardClass} mb-6 flex items-start gap-3 border-amber-200 bg-amber-50`}>
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            Integração com a LW Tecnologia não configurada (LW_API_LOGIN/LW_API_SENHA). Configure as credenciais para
            sincronizar as multas da frota.
          </p>
        </div>
      )}

      {prazoVencendo.length > 0 && (
        <div className={`${cardClass} mb-6 flex items-start gap-3 border-red-200 bg-red-50`}>
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm text-red-800">
            {prazoVencendo.length} multa(s) com prazo de indicação de condutor vencendo em até 5 dias.
          </p>
        </div>
      )}

      <div className={`${cardClass} overflow-x-auto p-0`}>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Placa</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">AIT</th>
              <th className="px-4 py-3">Situação</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Prazo indicação</th>
              <th className="px-4 py-3">Condutor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {multas.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-700">
                  {m.vehicle?.plate ?? m.placaConsultada}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {m.dataInfracao ? format(m.dataInfracao, "dd/MM/yyyy") : "—"}
                  {m.horaInfracao ? ` ${m.horaInfracao}` : ""}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{m.ait ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className={`${badgeClass} ${SITUACAO_BADGE[m.situacaoLw ?? ""] ?? "bg-slate-100 text-slate-600"}`}>
                    {m.situacaoLw ?? "—"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatBRL(m.valorCents)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {m.dataLimiteIndicacao ? format(m.dataLimiteIndicacao, "dd/MM/yyyy") : "—"}
                </td>
                <td className="px-4 py-3">
                  <IndicacaoCell multaId={m.id} indicacao={m.indicacao} drivers={drivers} />
                </td>
              </tr>
            ))}
            {multas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                  {available ? "Nenhuma multa sincronizada ainda." : "Integração não configurada."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
