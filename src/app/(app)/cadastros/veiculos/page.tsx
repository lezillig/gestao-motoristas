import Link from "next/link";
import { Pencil } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";

const STATUS_LABEL: Record<string, string> = {
  ATIVO: "Ativo",
  MANUTENCAO: "Em manutenção",
  INATIVO: "Inativo",
};

const STATUS_TONE: Record<string, string> = {
  ATIVO: "bg-emerald-100 text-emerald-700",
  MANUTENCAO: "bg-amber-100 text-amber-700",
  INATIVO: "bg-slate-100 text-slate-500",
};

export default async function VeiculosPage() {
  const session = await requireSession();

  const vehicles = await prisma.vehicle.findMany({
    where: { companyId: session.companyId },
    orderBy: { plate: "asc" },
  });

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Veículos"
        subtitle="Frota disponível para vínculo nas escalas."
        actionHref="/cadastros/veiculos/novo"
        actionLabel="Novo veículo"
        secondaryActionHref="/cadastros/veiculos/importar"
        secondaryActionLabel="Importar planilha"
      />

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Placa</th>
                <th className="px-4 py-3">Veículo</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Ano</th>
                <th className="px-4 py-3">Km atual</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {vehicles.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Nenhum veículo cadastrado ainda.
                  </td>
                </tr>
              )}
              {vehicles.map((v) => (
                <tr key={v.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800">{v.plate}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {v.brand} {v.model}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{v.type}</td>
                  <td className="px-4 py-3 text-slate-600">{v.year}</td>
                  <td className="px-4 py-3 text-slate-600">{v.currentMileage.toLocaleString("pt-BR")} km</td>
                  <td className="px-4 py-3">
                    <span className={`${badgeClass} ${STATUS_TONE[v.status]}`}>
                      {STATUS_LABEL[v.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/cadastros/veiculos/${v.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
