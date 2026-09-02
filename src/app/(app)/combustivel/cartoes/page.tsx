import Link from "next/link";
import { format } from "date-fns";
import { CreditCard, AlertTriangle, Ban } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { isTicketLogAvailable } from "@/lib/ticketlog/client";
import TicketLogSyncButton from "./TicketLogSyncButton";

function formatBRL(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const SITUACAO_LABELS: Record<string, { label: string; tone: string }> = {
  A: { label: "Ativo", tone: "bg-emerald-100 text-emerald-700" },
  B: { label: "Bloqueado", tone: "bg-red-100 text-red-700" },
  C: { label: "Cancelado", tone: "bg-slate-100 text-slate-500" },
  U: { label: "Cancelado (usuário)", tone: "bg-slate-100 text-slate-500" },
};

export default async function CartoesCombustivelPage() {
  const session = await requireRole("ADMIN", "GESTOR");

  const statuses = await prisma.fuelCardStatus.findMany({
    where: { companyId: session.companyId },
    include: { vehicle: true },
    orderBy: [{ saldoCents: "asc" }],
  });

  const ativos = statuses.filter((s) => s.situacaoCartao === "A");
  const bloqueados = statuses.filter((s) => s.situacaoCartao === "B");
  const semVinculo = statuses.filter((s) => !s.vehicleId);
  const saldoBaixo = ativos.filter((s) => s.limiteCents != null && s.limiteCents > 0 && s.saldoCents != null && s.saldoCents / s.limiteCents < 0.1);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Cartões combustível (Ticket Log)"
        subtitle="Status de saldo e limite por veículo/cartão, direto da API da Ticket Log — não é o extrato de abastecimentos (isso continua em Combustível)."
      />

      <p className="mb-4 text-xs text-slate-400">
        <Link href="/combustivel" className="text-blue-700 hover:underline">
          ← Voltar para Combustível
        </Link>
      </p>

      {!isTicketLogAvailable() ? (
        <p className={`${cardClass} text-sm text-slate-500`}>
          Credenciais da Ticket Log não configuradas (TICKETLOG_API_BASE_URL/TICKETLOG_BASIC_AUTH/TICKETLOG_CODIGOS_CLIENTE/TICKETLOG_CODIGO_PRODUTO).
        </p>
      ) : (
        <>
          <div className="mb-6 flex justify-end">
            <TicketLogSyncButton />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className={cardClass}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                <CreditCard className="h-4 w-4" />
              </div>
              <p className="text-2xl font-semibold text-slate-900">{statuses.length}</p>
              <p className="mt-0.5 text-xs text-slate-500">Cartões sincronizados</p>
            </div>
            <div className={cardClass}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-700">
                <Ban className="h-4 w-4" />
              </div>
              <p className="text-2xl font-semibold text-slate-900">{bloqueados.length}</p>
              <p className="mt-0.5 text-xs text-slate-500">Bloqueados</p>
            </div>
            <div className={cardClass}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <p className="text-2xl font-semibold text-slate-900">{saldoBaixo.length}</p>
              <p className="mt-0.5 text-xs text-slate-500">Ativos com menos de 10% do limite disponível</p>
            </div>
            <div className={cardClass}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <p className="text-2xl font-semibold text-slate-900">{semVinculo.length}</p>
              <p className="mt-0.5 text-xs text-slate-500">Sem veículo vinculado no cadastro</p>
            </div>
          </div>

          <div className={`${cardClass} p-0 overflow-hidden`}>
            <div className="overflow-x-auto scroll-visible">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Placa</th>
                    <th className="px-4 py-3">Modelo</th>
                    <th className="px-4 py-3">Responsável</th>
                    <th className="px-4 py-3">Combustível padrão</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                    <th className="px-4 py-3 text-right">Limite</th>
                    <th className="px-4 py-3 text-right">Compras no período</th>
                    <th className="px-4 py-3">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {statuses.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                        Nenhum cartão sincronizado ainda — clique em &quot;Sincronizar com Ticket Log&quot;.
                      </td>
                    </tr>
                  )}
                  {statuses.map((s) => {
                    const situacao = s.situacaoCartao ? SITUACAO_LABELS[s.situacaoCartao] : null;
                    const percentualDisponivel =
                      s.limiteCents && s.limiteCents > 0 && s.saldoCents != null
                        ? (s.saldoCents / s.limiteCents) * 100
                        : null;
                    return (
                      <tr key={s.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.vehicle?.plate ?? s.placaOriginal ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-600">{s.vehicle?.model ?? s.modeloVeiculo ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-600">{s.nomeResponsavel ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-600">{s.tipoCombustivelPadrao ?? "—"}</td>
                        <td className={`px-4 py-3 text-right font-medium ${percentualDisponivel != null && percentualDisponivel < 10 ? "text-red-600" : "text-slate-800"}`}>
                          {formatBRL(s.saldoCents)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">{formatBRL(s.limiteCents)}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{formatBRL(s.comprasPeriodoCents)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {situacao ? (
                              <span className={`${badgeClass} ${situacao.tone}`}>{situacao.label}</span>
                            ) : (
                              <span className={`${badgeClass} bg-slate-100 text-slate-500`}>{s.situacaoCartao ?? "—"}</span>
                            )}
                            {!s.vehicleId && <span className={`${badgeClass} bg-amber-100 text-amber-700`}>Sem veículo</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {statuses.length > 0 && (
            <p className="mt-3 text-xs text-slate-400">
              Última sincronização: {format(statuses[0].syncedAt, "dd/MM/yyyy HH:mm")}. Ordenado por saldo (menor
              primeiro).
            </p>
          )}
        </>
      )}
    </div>
  );
}
