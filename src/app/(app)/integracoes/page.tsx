import Link from "next/link";
import { Clock, Fuel, Truck } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { requireRole } from "@/lib/auth";
import { isSofitConfigured } from "@/lib/sofit/config";
import { isTiqueTaqueAvailable } from "@/lib/tiquetaque/client";
import { badgeClass, cardClass } from "@/lib/ui";

export default async function IntegracoesPage() {
  await requireRole("ADMIN", "GESTOR");

  const integracoes = [
    {
      nome: "Sofit",
      descricao: "Gestão de frota: veículos, abastecimentos, manutenções e odômetro.",
      href: "/integracoes/sofit",
      icone: Truck,
      ativa: isSofitConfigured(),
    },
    {
      nome: "TiqueTaque",
      descricao: "Ponto eletrônico: batidas, folgas, atestados e férias.",
      href: "/ponto/importar-tiquetaque",
      icone: Clock,
      ativa: isTiqueTaqueAvailable(),
    },
    {
      nome: "Cartão combustível (planilha)",
      descricao: "Extrato do cartão importado por planilha — sem API do lado cliente-frota.",
      href: "/combustivel/importar",
      icone: Fuel,
      ativa: true,
    },
  ];

  return (
    <div className="max-w-4xl">
      <PageHeader title="Integrações" subtitle="Sistemas externos conectados a este sistema." />

      <div className="grid gap-4 sm:grid-cols-2">
        {integracoes.map((integracao) => {
          const Icone = integracao.icone;
          return (
            <Link key={integracao.nome} href={integracao.href} className={`${cardClass} block hover:border-slate-300`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <Icone className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{integracao.nome}</p>
                    <p className="mt-1 text-xs text-slate-500">{integracao.descricao}</p>
                  </div>
                </div>
                <span
                  className={`${badgeClass} shrink-0 ${
                    integracao.ativa ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {integracao.ativa ? "Ativa" : "Desligada"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
