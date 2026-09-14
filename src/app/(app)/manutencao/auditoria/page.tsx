import Link from "next/link";
import { format, subDays } from "date-fns";
import { ArrowLeft, Download, ShieldCheck } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { cardClass, badgeClass, secondaryButtonClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { auditarSofit, historicoAuditoria, registrarSnapshotAuditoria, type Gravidade } from "@/lib/sofit/auditoria";
import { brazilDayLabel } from "@/lib/date";
import EvolucaoAuditoria from "./EvolucaoAuditoria";

const GRAV: Record<Gravidade, { label: string; cls: string }> = {
  alta: { label: "Alta", cls: "bg-red-100 text-red-700" },
  media: { label: "Média", cls: "bg-amber-100 text-amber-700" },
  baixa: { label: "Baixa", cls: "bg-slate-100 text-slate-600" },
};
const LINHAS_POR_ACHADO = 40;

export default async function AuditoriaSofitPage({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { todos } = await searchParams;
  const a = await auditarSofit(session.companyId);
  // O retrato do dia tambem e gravado ao abrir a pagina (alem do fim da
  // sincronizacao diaria), pra o historico comecar a contar ja. Falha aqui
  // nao impede de mostrar a auditoria.
  await registrarSnapshotAuditoria(session.companyId, a).catch(() => {});
  const historico = await historicoAuditoria(session.companyId);

  // Base da comparacao: o retrato mais recente de ate 7 dias atras; sem
  // historico tao antigo, o primeiro registrado.
  const atual = historico.at(-1);
  const alvo = format(subDays(brazilDayLabel(0), 7), "yyyy-MM-dd");
  const base = [...historico].reverse().find((h) => h.dia <= alvo) ?? (historico.length > 1 ? historico[0] : undefined);
  const variacao =
    atual && base && base.dia !== atual.dia
      ? [...new Set([...Object.keys(base.porChave), ...Object.keys(atual.porChave)])]
          .map((chave) => ({
            chave,
            titulo: atual.porChave[chave]?.titulo ?? base.porChave[chave]?.titulo ?? chave,
            antes: base.porChave[chave]?.n ?? 0,
            agora: atual.porChave[chave]?.n ?? 0,
          }))
          .filter((v) => v.antes !== v.agora)
          .sort((x, y) => x.agora - x.antes - (y.agora - y.antes))
      : [];

  return (
    <div>
      <div className="mb-4">
        <Link href="/manutencao" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Voltar pra Manutenção
        </Link>
      </div>
      <PageHeader
        title="Auditoria de dados da Sofit"
        subtitle="O que está errado ou desatualizado na Sofit, em listas prontas para a equipe corrigir lá. Nada é alterado por aqui."
        extra={
          <a href="/api/manutencao/auditoria/exportar" className={`${secondaryButtonClass} inline-flex items-center gap-1.5 text-xs`}>
            <Download className="h-3.5 w-3.5" /> Baixar planilha (uma aba por item)
          </a>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Gerado em {format(a.geradoEm, "dd/MM/yyyy HH:mm")} ·</span>
        <span className="font-medium text-slate-800">{a.totalLinhas} apontamento(s)</span>
        <span className={`${badgeClass} ${GRAV.alta.cls}`}>Alta {a.porGravidade.alta}</span>
        <span className={`${badgeClass} ${GRAV.media.cls}`}>Média {a.porGravidade.media}</span>
        <span className={`${badgeClass} ${GRAV.baixa.cls}`}>Baixa {a.porGravidade.baixa}</span>
        {a.achados.length > 0 && !todos && (
          <Link href="/manutencao/auditoria?todos=1" className="ml-auto text-xs font-medium text-blue-700 hover:underline">
            Mostrar todas as linhas
          </Link>
        )}
      </div>

      <EvolucaoAuditoria
        pontos={historico.map(({ dia, total, alta, media, baixa }) => ({ dia, total, alta, media, baixa }))}
        variacao={variacao}
        baseDia={base && atual && base.dia !== atual.dia ? base.dia : null}
      />

      {a.achados.length === 0 ? (
        <div className={`${cardClass} flex items-center gap-2 text-sm text-emerald-700`}>
          <ShieldCheck className="h-5 w-5" /> Nenhuma inconsistência encontrada no espelho atual da Sofit.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {a.achados.map((ach) => {
            const linhas = todos ? ach.linhas : ach.linhas.slice(0, LINHAS_POR_ACHADO);
            return (
              <section key={ach.chave} className={`${cardClass} p-0 overflow-hidden`}>
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      {ach.titulo} <span className={`${badgeClass} ml-1 ${GRAV[ach.gravidade].cls}`}>{ach.linhas.length}</span>
                    </h2>
                    <p className="mt-0.5 max-w-3xl text-xs text-slate-500">{ach.oQueFazer}</p>
                  </div>
                  <span className={`${badgeClass} ${GRAV[ach.gravidade].cls}`}>Gravidade {GRAV[ach.gravidade].label.toLowerCase()}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        {ach.colunas.map((c) => (
                          <th key={c} className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((l, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          {ach.colunas.map((c) => {
                            const v = l[c];
                            return (
                              <td key={c} className={`px-4 py-1.5 text-slate-700 ${typeof v === "number" ? "tabular-nums" : ""} ${c === "Placa" || c === "Placa na Sofit" ? "font-mono text-xs" : ""}`}>
                                {v == null ? "—" : typeof v === "number" ? v.toLocaleString("pt-BR") : v}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ach.linhas.length > linhas.length && (
                  <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                    Mostrando {linhas.length} de {ach.linhas.length} — a planilha traz todas.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
