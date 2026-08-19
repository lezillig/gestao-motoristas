import { format, subDays } from "date-fns";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { describeSofitConfig } from "@/lib/sofit/config";
import { SOFIT_ENTITIES, SOFIT_ENTITY_LABELS, type SofitEntity } from "@/lib/sofit/types";
import { badgeClass, cardClass } from "@/lib/ui";
import SofitSyncForm from "./SofitSyncForm";

const ORIGEM_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  CRON: "Agendado",
  WEBHOOK: "Push do Sofit",
};

type Mensagem = { tipo: "erro" | "aviso"; texto: string };

function lerMensagens(valor: unknown): Mensagem[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter(
    (item): item is Mensagem =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Mensagem).texto === "string" &&
      ((item as Mensagem).tipo === "erro" || (item as Mensagem).tipo === "aviso")
  );
}

// Tres situacoes, nao duas: uma execucao que rodou inteira mas descartou
// alguns registros (placa invalida no Sofit, veiculo de outra empresa) e
// diferente de uma que nao rodou (credencial errada, API fora). So a
// segunda impede o marco incremental de avancar — ver registrarSyncLog.
function situacaoDoLog(log: { sucesso: boolean; mensagens: unknown }): {
  rotulo: string;
  classe: string;
  ok: boolean;
} {
  if (!log.sucesso) return { rotulo: "Falhou", classe: "bg-red-50 text-red-700", ok: false };
  const temErro = lerMensagens(log.mensagens).some((m) => m.tipo === "erro");
  if (temErro) return { rotulo: "Parcial", classe: "bg-amber-50 text-amber-700", ok: false };
  return { rotulo: "OK", classe: "bg-emerald-50 text-emerald-700", ok: true };
}

// Variaveis lidas por src/lib/sofit/config.ts — listadas aqui pra tela
// conseguir dizer exatamente o que falta configurar (a pagina NUNCA mostra
// valor de credencial, so o nome da variavel).
const VARIAVEIS_OBRIGATORIAS = [
  "SOFIT_API_URL",
  "SOFIT_API_TOKEN (ou SOFIT_USERNAME + SOFIT_PASSWORD)",
];

export default async function SofitIntegracaoPage() {
  const session = await requireRole("ADMIN", "GESTOR");
  const config = describeSofitConfig();

  const logs = await prisma.sofitSyncLog.findMany({
    where: { companyId: session.companyId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const ultimoPorEntidade = new Map<SofitEntity, (typeof logs)[number]>();
  for (const log of logs) {
    const entidade = log.entidade as SofitEntity;
    if (!ultimoPorEntidade.has(entidade)) ultimoPorEntidade.set(entidade, log);
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Sofit — gestão de frota"
        subtitle="Importa veículos, abastecimentos, manutenções e odômetro direto da API do Sofit."
      />

      <div className={`${cardClass} mb-6`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-800">
              {config.configurado ? "Integração configurada" : "Integração não configurada"}
            </p>
            {config.configurado ? (
              <p className="mt-1 text-xs text-slate-500">
                {config.baseUrl} · autenticação {config.authMode}
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                Defina no ambiente: {VARIAVEIS_OBRIGATORIAS.join(", ")}. Enquanto isso, a sincronização fica
                desligada — nenhuma outra parte do sistema é afetada.
              </p>
            )}
          </div>
          <span
            className={`${badgeClass} ${
              config.configurado ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            {config.configurado ? "Ativa" : "Desligada"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {SOFIT_ENTITIES.map((entidade) => {
            const ultimo = ultimoPorEntidade.get(entidade);
            return (
              <div key={entidade}>
                <p className="text-xs font-medium text-slate-500">{SOFIT_ENTITY_LABELS[entidade]}</p>
                {ultimo ? (
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-800">
                    {situacaoDoLog(ultimo).ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <AlertTriangle
                        className={`h-3.5 w-3.5 ${ultimo.sucesso ? "text-amber-600" : "text-red-600"}`}
                      />
                    )}
                    {format(ultimo.createdAt, "dd/MM/yyyy HH:mm")}
                  </p>
                ) : (
                  <p className="mt-0.5 text-sm text-slate-400">nunca sincronizado</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={`${cardClass} mb-6`}>
        <h2 className="mb-4 text-sm font-semibold text-slate-800">Sincronizar</h2>
        <SofitSyncForm
          configurado={config.configurado}
          defaultStartDate={format(subDays(new Date(), 7), "yyyy-MM-dd")}
          defaultEndDate={format(new Date(), "yyyy-MM-dd")}
        />
      </div>

      <div className={cardClass}>
        <h2 className="mb-4 text-sm font-semibold text-slate-800">Histórico de sincronizações</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma sincronização registrada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500">
                  <th className="py-2 pr-3">Quando</th>
                  <th className="py-2 pr-3">Entidade</th>
                  <th className="py-2 pr-3">Origem</th>
                  <th className="py-2 pr-3">Período</th>
                  <th className="py-2 pr-3 text-right">Lidos</th>
                  <th className="py-2 pr-3 text-right">Novos</th>
                  <th className="py-2 pr-3 text-right">Atualizados</th>
                  <th className="py-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const situacao = situacaoDoLog(log);
                  const mensagens = lerMensagens(log.mensagens);
                  return (
                  <tr key={log.id} className="border-b border-slate-100 align-top text-slate-700">
                    <td className="py-2 pr-3 whitespace-nowrap">{format(log.createdAt, "dd/MM/yyyy HH:mm")}</td>
                    <td className="py-2 pr-3">{SOFIT_ENTITY_LABELS[log.entidade as SofitEntity] ?? log.entidade}</td>
                    <td className="py-2 pr-3">{ORIGEM_LABELS[log.origem] ?? log.origem}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                      {log.periodoInicio && log.periodoFim
                        ? `${format(log.periodoInicio, "dd/MM")} – ${format(log.periodoFim, "dd/MM/yyyy")}`
                        : "cadastro completo"}
                    </td>
                    <td className="py-2 pr-3 text-right">{log.lidos}</td>
                    <td className="py-2 pr-3 text-right">{log.criados}</td>
                    <td className="py-2 pr-3 text-right">{log.atualizados}</td>
                    <td className="py-2">
                      <span className={`${badgeClass} ${situacao.classe}`}>{situacao.rotulo}</span>
                      {mensagens.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-slate-500">
                            {mensagens.length} mensagem(ns)
                          </summary>
                          <ul className="mt-1 max-h-40 max-w-md list-disc space-y-1 overflow-y-auto pl-4 text-xs">
                            {mensagens.map((mensagem, i) => (
                              <li key={i} className={mensagem.tipo === "erro" ? "text-red-600" : "text-amber-700"}>
                                {mensagem.texto}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
