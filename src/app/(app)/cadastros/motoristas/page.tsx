import Link from "next/link";
import { format } from "date-fns";
import { Pencil, Search } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass, inputClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { cnhAlertLevel, daysUntil } from "@/lib/driverAlerts";
import { toggleDriverActive } from "./actions";
import type { Prisma } from "@prisma/client";

export default async function MotoristasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sindicatoId?: string; status?: string }>;
}) {
  const session = await requireSession();
  const { q, sindicatoId, status } = await searchParams;

  const where: Prisma.DriverWhereInput = { companyId: session.companyId };
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { cpf: { contains: q } },
    ];
  }
  if (sindicatoId) where.sindicatoId = sindicatoId;
  if (status === "ativo") where.active = true;
  if (status === "inativo") where.active = false;

  const [drivers, sindicatos] = await Promise.all([
    prisma.driver.findMany({
      where,
      include: { sindicato: true },
      orderBy: { name: "asc" },
    }),
    prisma.sindicato.findMany({
      where: { companyId: session.companyId, active: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Motoristas"
        subtitle="Cadastro base do motorista, com vínculo sindical para o motor de conformidade."
        actionHref="/cadastros/motoristas/novo"
        actionLabel="Novo motorista"
        secondaryActionHref="/cadastros/motoristas/importar"
        secondaryActionLabel="Importar planilha"
      />

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600">Buscar</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Nome ou CPF"
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Sindicato</label>
          <select name="sindicatoId" defaultValue={sindicatoId ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {sindicatos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
          <select name="status" defaultValue={status ?? ""} className={inputClass}>
            <option value="">Todos</option>
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filtrar
        </button>
      </form>

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">CPF</th>
                <th className="px-4 py-3">Sindicato</th>
                <th className="px-4 py-3">CNH</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {drivers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Nenhum motorista encontrado.
                  </td>
                </tr>
              )}
              {drivers.map((d) => {
                const level = cnhAlertLevel(d.cnhExpiration);
                const days = daysUntil(d.cnhExpiration);
                return (
                  <tr key={d.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{d.name}</td>
                    <td className="px-4 py-3 text-slate-600">{d.cpf}</td>
                    <td className="px-4 py-3 text-slate-600">{d.sindicato?.nome ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600">
                          {d.cnhCategory} · {format(d.cnhExpiration, "dd/MM/yyyy")}
                        </span>
                        {level !== "ok" && (
                          <span
                            className={`${badgeClass} ${
                              level === "vencida"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {level === "vencida" ? `Vencida há ${Math.abs(days)}d` : `${days}d`}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <form action={toggleDriverActive.bind(null, d.id, !d.active)}>
                        <button
                          type="submit"
                          className={`${badgeClass} ${
                            d.active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {d.active ? "Ativo" : "Inativo"}
                        </button>
                      </form>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/cadastros/motoristas/${d.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
