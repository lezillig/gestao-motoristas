import Link from "next/link";
import { addDays, format, min as minDate } from "date-fns";
import type { ComponentType } from "react";
import {
  Clock,
  CalendarDays,
  Fuel,
  CreditCard,
  Gauge,
  Satellite,
  FileSpreadsheet,
  FileText,
  ArrowRight,
} from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, secondaryButtonClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import { isSiatAvailable } from "@/lib/siat/client";
import { isSofitAvailable } from "@/lib/sofit/client";
import { isTicketLogAvailable } from "@/lib/ticketlog/client";
import { isIturanAvailable } from "@/lib/ituran/client";
import AnpSyncButton from "../combustivel/AnpSyncButton";
import SofitSyncButton from "../combustivel/SofitSyncButton";
import LeaveImportButton from "../afastamentos/LeaveImportButton";
import SyncAllButton from "./SyncAllButton";
import GapStatusPanel from "./GapStatusPanel";
import { checkAllGaps, RECURRING_GAP_WINDOW_DAYS } from "@/lib/integrationGaps";

function GoTo({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={`${secondaryButtonClass} inline-flex items-center gap-1.5 text-xs`}>
      {label} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

function IntegrationCard({
  icon: Icon,
  title,
  description,
  unavailable,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  unavailable?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cardClass}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
        {unavailable && (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            Não configurado
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-slate-500">{description}</p>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

// Reune num lugar so tudo que hoje fica espalhado como botao/link contextual
// dentro de cada tela (Ponto, Escalas, Combustível, Cadastros...) — pedido
// explicito do usuario pra nao precisar lembrar em qual tela fica a
// sincronização de qual sistema. Os links/botoes daqui apontam pras MESMAS
// paginas e Server Actions ja existentes (nenhuma logica nova) - isso so
// organiza a navegação, não substitui os atalhos contextuais que já
// existiam em cada tela.
export default async function IntegracoesPage() {
  const session = await requireRole("ADMIN", "GESTOR");
  const mesAtual = format(new Date(), "yyyy-MM");
  const today = new Date();

  // Mesmo calculo de "desde a ultima vez" ja usado em /ponto/importar-
  // tiquetaque e /escalas/importar-siat — reaproveitado aqui pra alimentar
  // o botao "Sincronizar tudo" com o mesmo intervalo padrao que cada tela
  // já usaria sozinha.
  const [lastImported, lastSynced] = await Promise.all([
    prisma.timeClockEntry.findFirst({
      where: { companyId: session.companyId, fonte: { in: ["TIQUETAQUE", "TIQUETAQUE_CSV"] } },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    prisma.escala.findFirst({
      where: { companyId: session.companyId, fonte: "SIAT" },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
  ]);
  const pontoRange = {
    start: format(lastImported ? minDate([addDays(lastImported.date, 1), today]) : today, "yyyy-MM-dd"),
    end: format(today, "yyyy-MM-dd"),
  };
  const siatRange = {
    start: format(lastSynced ? minDate([addDays(lastSynced.date, 1), today]) : today, "yyyy-MM-dd"),
    end: format(today, "yyyy-MM-dd"),
  };

  const gaps = await checkAllGaps(session.companyId, RECURRING_GAP_WINDOW_DAYS);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Integrações"
        subtitle="Sincronizações automáticas e uploads manuais, organizados por sistema."
      />

      <SyncAllButton
        tiquetaqueAvailable={isTiqueTaqueAvailable()}
        siatAvailable={isSiatAvailable()}
        sofitAvailable={isSofitAvailable()}
        ticketLogAvailable={isTicketLogAvailable()}
        pontoRange={pontoRange}
        siatRange={siatRange}
        mesAtual={mesAtual}
      />

      <GapStatusPanel initial={gaps} />

      <Section title="Sistemas externos">
        <IntegrationCard
          icon={Clock}
          title="TiqueTaque"
          description="Ponto eletrônico, cadastro de funcionários e afastamentos (folgas/atestados/férias). Roda sozinho toda madrugada; dá pra importar/atualizar na hora também."
          unavailable={!isTiqueTaqueAvailable()}
        >
          <div className="flex flex-col gap-3">
            <GoTo href="/ponto/importar-tiquetaque" label="Importar ponto/funcionários" />
            {isTiqueTaqueAvailable() && <LeaveImportButton />}
          </div>
        </IntegrationCard>

        <IntegrationCard
          icon={CalendarDays}
          title="SIAT"
          description="Escalas programadas dos motoristas. Roda sozinho toda madrugada; dá pra sincronizar na hora também."
          unavailable={!isSiatAvailable()}
        >
          <GoTo href="/escalas/importar-siat" label="Sincronizar agora" />
        </IntegrationCard>

        <IntegrationCard
          icon={Fuel}
          title="Sofit"
          description="Abastecimentos e vencimento de CNH. O CNH roda sozinho toda madrugada (sem botão manual); o combustível dá pra sincronizar na hora abaixo."
          unavailable={!isSofitAvailable()}
        >
          {isSofitAvailable() ? (
            <SofitSyncButton />
          ) : (
            <p className="text-xs text-slate-400">Configure SOFIT_API_URL/SOFIT_TOKEN pra habilitar.</p>
          )}
        </IntegrationCard>

        <IntegrationCard
          icon={CreditCard}
          title="Ticket Log"
          description="Saldo e limite dos cartões de combustível da frota. Roda sozinho toda madrugada."
          unavailable={!isTicketLogAvailable()}
        >
          <GoTo href="/combustivel/cartoes" label="Ver cartões" />
        </IntegrationCard>

        <IntegrationCard
          icon={Gauge}
          title="ANP"
          description="Preço médio de revenda de combustível por município, pra comparar com o que a frota pagou. Fonte pública, sem credencial."
        >
          <AnpSyncButton mes={mesAtual} />
        </IntegrationCard>

        <IntegrationCard
          icon={Satellite}
          title="Ituran"
          description="GPS, velocidade e viagens da frota. Roda sozinho toda madrugada (D-1); dá pra gerar leituras na hora também."
          unavailable={!isIturanAvailable()}
        >
          <GoTo href="/telemetria" label="Ir pra Telemetria" />
        </IntegrationCard>
      </Section>

      <Section title="Planilhas manuais">
        <IntegrationCard
          icon={FileSpreadsheet}
          title="Motoristas"
          description="Cadastro em lote, folha de pagamento (De/Para de sindicato) e importação do TiqueTaque."
        >
          <GoTo href="/cadastros/motoristas/importar" label="Importar" />
        </IntegrationCard>

        <IntegrationCard icon={FileSpreadsheet} title="Veículos" description="Cadastro de veículos em lote.">
          <GoTo href="/cadastros/veiculos/importar" label="Importar" />
        </IntegrationCard>

        <IntegrationCard
          icon={FileSpreadsheet}
          title="Clientes"
          description="Centro de custo, a partir de planilha ou da unidade de alocação já cadastrada."
        >
          <GoTo href="/cadastros/clientes/importar" label="Importar" />
        </IntegrationCard>

        <IntegrationCard
          icon={FileSpreadsheet}
          title="Extrato de combustível"
          description="Extrato do cartão Ticket Log, pra quando não vier automaticamente pela Sofit."
        >
          <GoTo href="/combustivel/importar" label="Importar" />
        </IntegrationCard>

        <IntegrationCard
          icon={FileSpreadsheet}
          title="Resumo de consumo"
          description="Relatório exportado do sistema de gestão de frota."
        >
          <GoTo href="/combustivel/resumo/importar" label="Importar" />
        </IntegrationCard>
      </Section>

      <Section title="Documentos">
        <IntegrationCard
          icon={FileText}
          title="Convenção coletiva"
          description="Upload do PDF de CCT/ACT por sindicato, pra alimentar o motor de conformidade."
        >
          <GoTo href="/convencoes/novo" label="Enviar novo" />
        </IntegrationCard>
      </Section>
    </div>
  );
}
