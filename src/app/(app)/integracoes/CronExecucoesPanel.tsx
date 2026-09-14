import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { cardClass, badgeClass } from "@/lib/ui";
import { utcInstantToLocalParts } from "@/lib/date";
import type { CronStatus, UltimaExecucao } from "@/lib/cronRun";

// Painel "Rotinas automáticas": ultima execucao de cada cron, status e
// erros — a evidencia que faltava pra saber se a integracao rodou de fato
// (a Vercel so mostra que a rota respondeu, e antes ela respondia 200 ate
// quando falhava).

const STATUS_LABEL: Record<CronStatus, string> = {
  ok: "OK",
  parcial: "Parcial",
  erro: "Falhou",
  pulado: "Não configurado",
  encadeamento_falhou: "Continuação falhou",
};

const STATUS_CLASS: Record<CronStatus, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  parcial: "bg-amber-50 text-amber-700",
  erro: "bg-red-50 text-red-700",
  pulado: "bg-slate-100 text-slate-500",
  encadeamento_falhou: "bg-red-50 text-red-700",
};

function Icone({ status }: { status: CronStatus | null }) {
  if (!status) return <CircleDashed className="h-4 w-4 text-slate-300" />;
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "parcial") return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  if (status === "pulado") return <CircleDashed className="h-4 w-4 text-slate-400" />;
  return <XCircle className="h-4 w-4 text-red-600" />;
}

function quando(d: Date): string {
  const p = utcInstantToLocalParts(d.toISOString());
  if (!p) return "—";
  const [y, m, dd] = p.dateISO.split("-");
  return `${dd}/${m}/${y.slice(2)} ${p.time}`;
}

function duracao(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export default function CronExecucoesPanel({ execucoes }: { execucoes: UltimaExecucao[] }) {
  const comProblema = execucoes.filter((e) => e.ultima && (e.ultima.status === "erro" || e.ultima.status === "encadeamento_falhou")).length;
  const semRegistro = execucoes.filter((e) => !e.ultima).length;
  return (
    <div className={`${cardClass} mb-8`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Rotinas automáticas — última execução</h2>
          <p className="text-xs text-slate-500">
            Registro gravado pela própria rotina ao terminar. Horários de Brasília. Histórico guardado por 60 dias.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {comProblema > 0 && <span className={`${badgeClass} bg-red-50 text-red-700`}>{comProblema} com falha</span>}
          {semRegistro > 0 && <span className={`${badgeClass} bg-slate-100 text-slate-500`}>{semRegistro} ainda sem execução registrada</span>}
          {comProblema === 0 && semRegistro === 0 && <span className={`${badgeClass} bg-emerald-50 text-emerald-700`}>Todas rodaram</span>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-3 font-medium">Rotina</th>
              <th className="py-2 pr-3 font-medium">Última execução</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 text-right font-medium">Itens</th>
              <th className="py-2 pr-3 text-right font-medium">Duração</th>
              <th className="py-2 pr-3 text-right font-medium">Falhas 24h</th>
              <th className="py-2 font-medium">Último erro</th>
            </tr>
          </thead>
          <tbody>
            {execucoes.map((e) => (
              <tr key={e.job} className="border-b border-slate-100 align-top last:border-0">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <Icone status={e.ultima?.status ?? null} />
                    <span className="font-medium text-slate-800">{e.label}</span>
                  </div>
                  <div className="pl-6 font-mono text-[11px] text-slate-400">{e.job}</div>
                </td>
                <td className="py-2 pr-3 tabular-nums text-slate-700">{e.ultima ? quando(e.ultima.finalizadoEm) : "—"}</td>
                <td className="py-2 pr-3">
                  {e.ultima ? (
                    <span className={`${badgeClass} ${STATUS_CLASS[e.ultima.status]}`}>
                      {STATUS_LABEL[e.ultima.status]}
                      {e.ultima.continuacao ? " · continua" : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">sem registro</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-700">{e.ultima ? e.ultima.processados.toLocaleString("pt-BR") : "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{e.ultima ? duracao(e.ultima.duracaoMs) : "—"}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${e.falhasUltimas24h > 0 ? "font-semibold text-red-700" : "text-slate-400"}`}>{e.falhasUltimas24h}</td>
                <td className="max-w-md py-2 text-xs text-slate-600">
                  {e.ultima && e.ultima.erros.length > 0 ? (
                    <span title={e.ultima.erros.join("\n")}>
                      {e.ultima.erros[0]}
                      {e.ultima.erros.length > 1 ? ` (+${e.ultima.erros.length - 1})` : ""}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{format(new Date(), "yyyy")} · &quot;Parcial&quot; = rodou, mas parte dos itens deu erro (a lista completa fica no título da célula).</p>
    </div>
  );
}
