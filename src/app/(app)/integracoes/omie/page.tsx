import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { isOmieAvailable } from "@/lib/omie/client";
import OmieSyncPanel from "./OmieSyncPanel";

// Um sync manual roda dentro desta rota; 60s é o teto do plano Hobby da Vercel
// (mesmo caso da rota de cron do TiqueTaque). O sync respeita um orçamento
// menor que isso e devolve resultado parcial em vez de estourar — ver
// SYNC_TIME_BUDGET_MS em actions.ts.
export const maxDuration = 60;

const RECURSO_LABEL: Record<string, string> = {
  CLIENTES: "Clientes",
  CONTAS_RECEBER: "Contas a receber",
  CONTAS_PAGAR: "Contas a pagar",
};

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function IntegracaoOmiePage() {
  const session = await requireRole("ADMIN", "GESTOR");
  const disponivel = isOmieAvailable();

  const [totalClientes, clientesVinculados, execucoes, porTipo] = await Promise.all([
    prisma.cliente.count({ where: { companyId: session.companyId } }),
    prisma.cliente.count({
      where: { companyId: session.companyId, omieCodigoCliente: { not: null } },
    }),
    prisma.omieSyncLog.findMany({
      where: { companyId: session.companyId },
      include: { executadoPor: { select: { name: true } } },
      orderBy: { iniciadoEm: "desc" },
      take: 15,
    }),
    prisma.omieLancamento.groupBy({
      by: ["tipo"],
      where: { companyId: session.companyId },
      _count: { _all: true },
      _sum: { valorCents: true },
    }),
  ]);

  const receber = porTipo.find((t) => t.tipo === "RECEBER");
  const pagar = porTipo.find((t) => t.tipo === "PAGAR");

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Omie"
        subtitle="Espelha clientes e títulos financeiros do ERP para cruzar receita e custo por contrato com as horas apuradas aqui."
      />

      {!disponivel && (
        <div className={`${cardClass} border-amber-200 bg-amber-50`}>
          <div className="flex items-start gap-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Integração não configurada.</p>
              <p className="mt-1">
                Defina <code className="rounded bg-amber-100 px-1">OMIE_APP_KEY</code> e{" "}
                <code className="rounded bg-amber-100 px-1">OMIE_APP_SECRET</code> nas variáveis de ambiente
                (App Key e App Secret da aplicação criada no painel do desenvolvedor do Omie). Sem elas, a
                sincronização fica indisponível — o resto do sistema continua funcionando normalmente.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className={cardClass}>
          <p className="text-2xl font-semibold text-slate-900">
            {clientesVinculados}
            <span className="text-base font-normal text-slate-400">/{totalClientes}</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Clientes vinculados ao Omie</p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-semibold text-slate-900">{receber?._count._all ?? 0}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Títulos a receber espelhados
            {receber?._sum.valorCents ? ` — ${formatCents(receber._sum.valorCents)}` : ""}
          </p>
        </div>
        <div className={cardClass}>
          <p className="text-2xl font-semibold text-slate-900">{pagar?._count._all ?? 0}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Títulos a pagar espelhados
            {pagar?._sum.valorCents ? ` — ${formatCents(pagar._sum.valorCents)}` : ""}
          </p>
        </div>
      </div>

      <OmieSyncPanel disponivel={disponivel} />

      <div>
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Últimas execuções</h2>
        <p className="mb-3 text-sm text-slate-500">
          Toda sincronização fica registrada, inclusive as que falharam no meio — é o que responde
          &ldquo;quando isto veio do ERP e o que entrou&rdquo; quando um número aparece diferente dos dois
          lados.
        </p>
        <div className={`${cardClass} p-0 overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Quando</th>
                  <th className="px-4 py-3">Recurso</th>
                  <th className="px-4 py-3">Período</th>
                  <th className="px-4 py-3">Resultado</th>
                  <th className="px-4 py-3">Origem</th>
                </tr>
              </thead>
              <tbody>
                {execucoes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      Nenhuma sincronização executada ainda.
                    </td>
                  </tr>
                )}
                {execucoes.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 text-slate-600">
                      {format(e.iniciadoEm, "dd/MM/yyyy HH:mm")}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {RECURSO_LABEL[e.recurso] ?? e.recurso}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {e.periodoInicio && e.periodoFim
                        ? `${format(e.periodoInicio, "dd/MM/yyyy")} – ${format(e.periodoFim, "dd/MM/yyyy")}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {e.erro ? (
                        <span className="flex items-start gap-1.5 text-red-700">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="line-clamp-2">{e.erro}</span>
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1.5 text-slate-600">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          {e.criados} novo(s), {e.atualizados} atualizado(s), {e.ignorados} ignorado(s)
                          {e.interrompido && (
                            <span className={`${badgeClass} gap-1 bg-amber-100 text-amber-800`}>
                              <Clock className="h-3 w-3" /> parcial
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {e.origem === "CRON" ? "Automática" : e.executadoPor?.name ?? "Manual"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
