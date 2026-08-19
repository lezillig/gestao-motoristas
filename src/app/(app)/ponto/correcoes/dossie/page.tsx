import Link from "next/link";
import { format, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ShieldCheck, ShieldAlert, ShieldQuestion, ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import { formatHoursMinutes } from "@/lib/time";
import { workedMinutes } from "@/lib/pontoCompliance";
import { parseLocalDate } from "@/lib/date";
import { verifyEntryIntegrity, type IntegrityStatus } from "@/lib/integrity";
import PrintButton from "./PrintButton";

const ORIGEM_LABELS: Record<string, string> = {
  TIQUETAQUE_REIMPORT: "Reimportação TiqueTaque",
  EDICAO_MANUAL: "Edição manual",
  EXCLUSAO_MANUAL: "Exclusão manual",
};

const INTEGRITY_META: Record<IntegrityStatus, { label: string; tone: string; Icon: typeof ShieldCheck }> = {
  integro: { label: "Íntegro", tone: "bg-emerald-100 text-emerald-700", Icon: ShieldCheck },
  divergente: { label: "Divergente", tone: "bg-red-100 text-red-700", Icon: ShieldAlert },
  nao_verificavel: { label: "Não verificável", tone: "bg-slate-100 text-slate-500", Icon: ShieldQuestion },
};

function turno(clockIn: string, clockOut: string | null, intervaloInicio: string | null, intervaloFim: string | null, punches: unknown) {
  if (!clockOut) return { range: `${clockIn}–em aberto`, worked: "em aberto" };
  const minutes = workedMinutes({ clockIn, clockOut, intervaloInicio, intervaloFim, punches });
  return { range: `${clockIn}–${clockOut}`, worked: minutes !== null ? formatHoursMinutes(minutes) : "—" };
}

export default async function DossiePage({
  searchParams,
}: {
  searchParams: Promise<{ driverId?: string; de?: string; ate?: string }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR", "FOLHA");
  const { driverId, de, ate } = await searchParams;

  if (!driverId) {
    return (
      <div className="max-w-2xl">
        <div className={cardClass}>
          <p className="text-sm text-slate-600">Selecione um motorista na tela de Histórico de correções para gerar o dossiê.</p>
          <Link href="/ponto/correcoes" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
            ← Voltar
          </Link>
        </div>
      </div>
    );
  }

  const ateDate = ate ? parseLocalDate(ate) : new Date();
  const deDate = de ? parseLocalDate(de) : subMonths(ateDate, 3);

  const [driver, company, entries, corrections, adminUser] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId, companyId: session.companyId } }),
    prisma.company.findUnique({ where: { id: session.companyId } }),
    prisma.timeClockEntry.findMany({
      where: { companyId: session.companyId, driverId, date: { gte: deDate, lte: ateDate } },
      orderBy: { date: "asc" },
    }),
    prisma.timeClockCorrection.findMany({
      where: { companyId: session.companyId, driverId, date: { gte: deDate, lte: ateDate } },
      orderBy: [{ date: "asc" }, { corrigidoEm: "asc" }],
    }),
    prisma.user.findUnique({ where: { id: session.userId } }),
  ]);

  if (!driver) {
    return (
      <div className="max-w-2xl">
        <div className={cardClass}>
          <p className="text-sm text-slate-600">Motorista não encontrado.</p>
        </div>
      </div>
    );
  }

  const userIds = [...new Set(corrections.map((c) => c.editadoPorUserId).filter((id): id is string => !!id))];
  const users = userIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const userNameById = new Map(users.map((u) => [u.id, u.name]));

  const correctionsByEntryId = new Map<string, typeof corrections>();
  for (const c of corrections) {
    if (!c.entryId) continue;
    const list = correctionsByEntryId.get(c.entryId) ?? [];
    list.push(c);
    correctionsByEntryId.set(c.entryId, list);
  }

  const integrityByEntryId = new Map<string, IntegrityStatus>();
  for (const entry of entries) {
    const entryCorrections = correctionsByEntryId.get(entry.id) ?? [];
    integrityByEntryId.set(
      entry.id,
      verifyEntryIntegrity(
        {
          hashAtual: entry.hashAtual,
          clockIn: entry.clockIn,
          clockOut: entry.clockOut,
          intervaloInicio: entry.intervaloInicio,
          intervaloFim: entry.intervaloFim,
          esperaInicio: entry.esperaInicio,
          esperaFim: entry.esperaFim,
          punches: entry.punches,
        },
        entryCorrections.map((c) => ({ hashAntes: c.hashAntes, hashDepois: c.hashDepois }))
      )
    );
  }

  const summary = { integro: 0, divergente: 0, nao_verificavel: 0 };
  for (const status of integrityByEntryId.values()) summary[status]++;

  // Conta EVENTOS de exclusão (origem), não linhas com entryId nulo — uma
  // correção de edição anterior ao registro TAMBÉM perde o entryId quando o
  // registro é excluído depois (mesma FK com onDelete: SetNull), então
  // `!c.entryId` sozinho contaria essa edição como um 2º "registro excluído"
  // quando só houve 1 exclusão de fato (bug real visto ao verificar: 1
  // edição + 1 exclusão do mesmo registro mostrava "2 registro(s)
  // excluído(s)").
  const deletedCorrections = corrections.filter((c) => c.origem === "EXCLUSAO_MANUAL");

  const geradoEm = format(new Date(), "dd/MM/yyyy HH:mm");

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-center justify-between" data-print-hide>
        <Link href="/ponto/correcoes" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <PrintButton />
      </div>

      <div className={`${cardClass} mb-6`}>
        <p className="text-xs uppercase tracking-wide text-slate-400">Dossiê de auditoria — registro de ponto</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{company?.name ?? "—"}</h1>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Motorista</p>
            <p className="font-medium text-slate-800">{driver.name}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">CPF</p>
            <p className="font-medium text-slate-800">{driver.cpf}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Período</p>
            <p className="font-medium text-slate-800">
              {format(deDate, "dd/MM/yyyy")} – {format(ateDate, "dd/MM/yyyy")}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Gerado em</p>
            <p className="font-medium text-slate-800">
              {geradoEm} · {adminUser?.name ?? "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        {(["integro", "divergente", "nao_verificavel"] as IntegrityStatus[]).map((status) => {
          const { label, tone, Icon } = INTEGRITY_META[status];
          return (
            <div key={status} className={cardClass}>
              <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}>
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-2xl font-semibold text-slate-900">{summary[status]}</p>
              <p className="mt-0.5 text-xs text-slate-500">{label}</p>
            </div>
          );
        })}
      </div>

      <div className={`${cardClass} mb-6 p-0 overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Jornada do período</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Data</th>
                <th className="px-3 py-2.5">Turno</th>
                <th className="px-3 py-2.5">Horas trabalhadas</th>
                <th className="px-3 py-2.5">Origem</th>
                <th className="px-3 py-2.5">Integridade</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    Nenhum registro de ponto no período.
                  </td>
                </tr>
              )}
              {entries.map((entry) => {
                const t = turno(entry.clockIn, entry.clockOut, entry.intervaloInicio, entry.intervaloFim, entry.punches);
                const status = integrityByEntryId.get(entry.id) ?? "nao_verificavel";
                const { label, tone } = INTEGRITY_META[status];
                return (
                  <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 text-slate-700">{format(entry.date, "dd/MM/yyyy (EEE)", { locale: ptBR })}</td>
                    <td className="px-3 py-2 text-slate-700">{t.range}</td>
                    <td className="px-3 py-2 text-slate-700">{t.worked}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {entry.fonte === "TIQUETAQUE_CSV" ? "TiqueTaque (planilha oficial)" : entry.fonte === "TIQUETAQUE" ? "TiqueTaque" : "Manual"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`${badgeClass} ${tone}`}>{label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${cardClass} mb-6 p-0 overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Histórico de alterações</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Turno (data)</th>
                <th className="px-3 py-2.5">Origem</th>
                <th className="px-3 py-2.5">Antes</th>
                <th className="px-3 py-2.5">Depois</th>
                <th className="px-3 py-2.5">Por quem / quando</th>
              </tr>
            </thead>
            <tbody>
              {corrections.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    Nenhuma alteração registrada no período.
                  </td>
                </tr>
              )}
              {corrections.map((c) => {
                const antes = turno(c.clockInAntes, c.clockOutAntes, c.intervaloInicioAntes, c.intervaloFimAntes, c.punchesAntes);
                const depois = c.clockInDepois
                  ? turno(c.clockInDepois, c.clockOutDepois, c.intervaloInicioDepois, c.intervaloFimDepois, c.punchesDepois)
                  : null;
                return (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 text-slate-700">{format(c.date, "dd/MM/yyyy")}</td>
                    <td className="px-3 py-2 text-slate-600">{ORIGEM_LABELS[c.origem] ?? c.origem}</td>
                    <td className="px-3 py-2 text-slate-400 line-through decoration-slate-300">{antes.range}</td>
                    <td className={`px-3 py-2 font-medium ${depois ? "text-amber-700" : "text-red-600"}`}>
                      {depois ? depois.range : "registro excluído"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {c.editadoPorUserId ? (userNameById.get(c.editadoPorUserId) ?? "—") : "sistema (TiqueTaque)"}
                      <br />
                      <span className="text-xs text-slate-400">{format(c.corrigidoEm, "dd/MM/yyyy HH:mm")}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {deletedCorrections.length > 0 && (
        <p className="mb-6 text-xs text-slate-500">
          {deletedCorrections.length} registro(s) excluído(s) manualmente no período — o turno em si não existe
          mais, mas o estado anterior à exclusão (acima) foi preservado permanentemente na trilha de auditoria.
        </p>
      )}

      <p className="text-xs text-slate-500">
        <strong>O que a verificação de integridade prova:</strong> cada registro tem um hash (impressão digital
        criptográfica) do seu conteúdo, atualizado a cada escrita feita por este sistema; toda alteração gera uma
        linha permanente no histórico acima com o hash antes/depois. "Íntegro" significa que a cadeia de hashes
        bate do início ao fim e o conteúdo atual do registro corresponde exatamente ao último hash registrado — ou
        seja, não há alteração de conteúdo sem uma linha correspondente explicando quem, quando e o quê. "Não
        verificável" cobre registros/alterações anteriores à existência deste recurso, nunca é tratado como
        violação. Isto não substitui perícia técnica nem aconselhamento jurídico.
      </p>
    </div>
  );
}
