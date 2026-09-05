import Link from "next/link";
import { addDays, format, subDays } from "date-fns";
import { AlertTriangle, ArrowLeft, CheckCircle2, SearchCheck } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass, primaryButtonClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { parseLocalDate } from "@/lib/date";

const LEAVE_LABELS: Record<string, string> = {
  folga: "Folga",
  atestado: "Atestado",
  ferias: "Férias",
  abono: "Abono",
};

// Versao "em lote" da Auditoria do dia (../page.tsx): em vez de escolher 1
// motorista de cada vez, roda a mesma pergunta basica — "tem escala e
// ponto batendo nesse dia?" — pra TODOS de uma vez, e so mostra quem tem
// divergencia. De proposito NAO cruza Ituran/abastecimento aqui (isso e
// por veiculo, mais pesado de fazer em lote pra empresa inteira) — pra
// esse detalhe, clica e vai pra auditoria completa daquele motorista/dia.
export default async function ExcecoesDoDiaPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { data } = await searchParams;

  // Padrao: ontem, nao hoje — os crons (TiqueTaque/SIAT) rodam de
  // madrugada buscando o dia anterior, entao "hoje" costuma estar
  // incompleto e geraria falso positivo de "sem ponto"/"sem escala".
  const dayStart = data ? parseLocalDate(data) : subDays(new Date(), 1);
  const dayEnd = addDays(dayStart, 1);

  const [drivers, escalas, entries, leaves] = await Promise.all([
    prisma.driver.findMany({
      where: { companyId: session.companyId, active: true },
      select: { id: true, name: true, funcao: true },
    }),
    prisma.escala.findMany({
      where: { companyId: session.companyId, date: { gte: dayStart, lt: dayEnd } },
      select: { driverId: true },
    }),
    prisma.timeClockEntry.findMany({
      where: { companyId: session.companyId, date: { gte: dayStart, lt: dayEnd } },
      select: { driverId: true },
    }),
    prisma.driverLeave.findMany({
      where: { companyId: session.companyId, startDate: { lte: dayStart }, endDate: { gte: dayStart } },
      select: { driverId: true, leaveType: true },
    }),
  ]);

  const driversComEscala = new Set(escalas.map((e) => e.driverId));
  const driversComPonto = new Set(entries.map((e) => e.driverId));
  const leaveByDriverId = new Map(leaves.map((l) => [l.driverId, l.leaveType]));

  type Excecao = { driverId: string; driverName: string; tipo: "escala_sem_ponto" | "ponto_sem_escala"; afastamento: string | null };
  const excecoes: Excecao[] = [];
  for (const d of drivers) {
    const temEscala = driversComEscala.has(d.id);
    const temPonto = driversComPonto.has(d.id);
    if (temEscala === temPonto) continue; // os 2 ou nenhum dos 2 — sem divergencia pra reportar
    const afastamento = leaveByDriverId.get(d.id) ?? null;
    excecoes.push({
      driverId: d.id,
      driverName: d.name,
      tipo: temEscala ? "escala_sem_ponto" : "ponto_sem_escala",
      afastamento: afastamento ? (LEAVE_LABELS[afastamento] ?? afastamento) : null,
    });
  }
  // Afastamento explica a ausencia — nao esconde a linha (o afastamento em
  // si pode estar mal cadastrado), mas manda pro fim da lista, priorizando
  // quem realmente precisa de atencao.
  excecoes.sort((a, b) => (a.afastamento ? 1 : 0) - (b.afastamento ? 1 : 0));

  const semAfastamento = excecoes.filter((e) => !e.afastamento).length;

  const prevDay = format(subDays(dayStart, 1), "yyyy-MM-dd");
  const nextDay = format(addDays(dayStart, 1), "yyyy-MM-dd");

  return (
    <div className="max-w-4xl">
      <div className="mb-4" data-print-hide>
        <Link href="/utilizacao/auditoria" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Ir pra auditoria motorista a motorista
        </Link>
      </div>

      <PageHeader
        title="Exceções do dia"
        subtitle="Todo mundo com escala e ponto que não batem, num dia só — sem precisar escolher motorista por motorista."
      />

      <div className="mb-6 flex items-center justify-between">
        <Link href={`/utilizacao/auditoria/excecoes?data=${prevDay}`} className="text-sm font-medium text-slate-600 hover:underline">
          ← {format(subDays(dayStart, 1), "dd/MM")}
        </Link>
        <div>
          <p className="text-sm font-medium text-slate-700">{format(dayStart, "dd/MM/yyyy")}</p>
          <form method="get" className="mt-1 flex items-center gap-2">
            <input type="date" name="data" defaultValue={format(dayStart, "yyyy-MM-dd")} className={`${inputClass} py-1 text-xs`} />
            <button type="submit" className={`${primaryButtonClass} py-1 text-xs`}>
              Ir
            </button>
          </form>
        </div>
        <Link href={`/utilizacao/auditoria/excecoes?data=${nextDay}`} className="text-sm font-medium text-slate-600 hover:underline">
          {format(addDays(dayStart, 1), "dd/MM")} →
        </Link>
      </div>

      {excecoes.length === 0 ? (
        <div className={`${cardClass} flex flex-col items-center gap-2 py-12 text-center text-emerald-700`}>
          <CheckCircle2 className="h-8 w-8" />
          <p className="text-sm font-medium">Nenhuma divergência de escala x ponto nesse dia.</p>
        </div>
      ) : (
        <div className={cardClass}>
          <p className="mb-3 text-sm text-slate-500">
            {semAfastamento} motorista(s) com divergência real
            {excecoes.length > semAfastamento && ` · ${excecoes.length - semAfastamento} explicado(s) por afastamento`}.
          </p>
          <ul className="divide-y divide-slate-100">
            {excecoes.map((e) => (
              <li key={e.driverId} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{e.driverName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`${badgeClass} ${e.afastamento ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700"}`}>
                      {e.tipo === "escala_sem_ponto" ? (
                        <>
                          <AlertTriangle className="mr-1 h-3 w-3" /> Escala sem ponto batido
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="mr-1 h-3 w-3" /> Ponto batido sem escala
                        </>
                      )}
                    </span>
                    {e.afastamento && <span className={`${badgeClass} bg-slate-100 text-slate-500`}>{e.afastamento}</span>}
                  </div>
                </div>
                <Link
                  href={`/utilizacao/auditoria?driverId=${e.driverId}&data=${format(dayStart, "yyyy-MM-dd")}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <SearchCheck className="h-3.5 w-3.5" /> Ver detalhes
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Não cruza Ituran nem abastecimento aqui (isso é por veículo, mais pesado de rodar pra empresa inteira de uma
        vez) — clique em &quot;Ver detalhes&quot; pra essa auditoria completa de um motorista/dia específico.
      </p>
    </div>
  );
}
