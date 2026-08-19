import Link from "next/link";
import { ArrowRight, Clock, Landmark } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { isOmieAvailable } from "@/lib/omie/client";
import { isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";

// Índice das integrações com sistemas externos. Mostra só o estado de
// configuração (variáveis de ambiente presentes), sem chamar nenhuma API: as
// duas integrações têm limite de consumo e um carregamento de página não pode
// gastar chamada — no Omie, chamada repetida vira bloqueio de 30 minutos (ver
// src/lib/omie/pace.ts).

type Integracao = {
  nome: string;
  descricao: string;
  href: string | null;
  configurada: boolean;
  variaveis: string;
  icon: React.ComponentType<{ className?: string }>;
};

export default async function IntegracoesPage() {
  await requireRole("ADMIN", "GESTOR");

  const integracoes: Integracao[] = [
    {
      nome: "Omie",
      descricao:
        "ERP financeiro: clientes e títulos a pagar/receber, para cruzar receita e custo por contrato com as horas apuradas aqui.",
      href: "/integracoes/omie",
      configurada: isOmieAvailable(),
      variaveis: "OMIE_APP_KEY, OMIE_APP_SECRET",
      icon: Landmark,
    },
    {
      nome: "TiqueTaque",
      descricao:
        "Ponto eletrônico: batidas, funcionários e afastamentos. Importação manual por período e sincronização automática diária do dia anterior.",
      href: "/ponto/importar-tiquetaque",
      configurada: isTiqueTaqueAvailable(),
      variaveis: "TIQUETAQUE_API_TOKEN",
      icon: Clock,
    },
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Integrações"
        subtitle="Sistemas externos conectados a este sistema."
      />

      <div className="space-y-3">
        {integracoes.map((integracao) => {
          const Icon = integracao.icon;
          const conteudo = (
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                <Icon className="h-5 w-5 text-slate-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-slate-900">{integracao.nome}</p>
                  <span
                    className={`${badgeClass} ${
                      integracao.configurada
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {integracao.configurada ? "Configurada" : "Não configurada"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{integracao.descricao}</p>
                {!integracao.configurada && (
                  <p className="mt-1 text-xs text-slate-500">
                    Falta definir: <code className="rounded bg-slate-100 px-1">{integracao.variaveis}</code>
                  </p>
                )}
              </div>
              {integracao.href && (
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
              )}
            </div>
          );

          return integracao.href ? (
            <Link
              key={integracao.nome}
              href={integracao.href}
              prefetch={false}
              className={`${cardClass} block transition-colors hover:border-slate-300 hover:bg-slate-50`}
            >
              {conteudo}
            </Link>
          ) : (
            <div key={integracao.nome} className={cardClass}>
              {conteudo}
            </div>
          );
        })}
      </div>
    </div>
  );
}
