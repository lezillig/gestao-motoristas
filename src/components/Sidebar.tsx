"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { Role } from "@prisma/client";
import {
  LayoutDashboard,
  IdCard,
  Landmark,
  Car,
  CalendarDays,
  Clock,
  ShieldAlert,
  FileText,
  Route,
  Satellite,
  Fuel,
  History,
  FileSpreadsheet,
  ChevronDown,
  CalendarOff,
  CalendarRange,
  PiggyBank,
  Users,
  Scale,
  FlaskConical,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[];
  children?: NavItem[];
};

const NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Painel",
    icon: LayoutDashboard,
    roles: ["ADMIN", "GESTOR"],
  },
  {
    href: "/cadastros/motoristas",
    label: "Motoristas",
    icon: IdCard,
    roles: ["ADMIN", "GESTOR"],
  },
  {
    href: "/cadastros/sindicatos",
    label: "Sindicatos",
    icon: Landmark,
    roles: ["ADMIN", "GESTOR"],
  },
  {
    href: "/cadastros/veiculos",
    label: "Veículos",
    icon: Car,
    roles: ["ADMIN", "GESTOR"],
  },
  {
    href: "/escalas",
    label: "Escalas",
    icon: CalendarDays,
    roles: ["ADMIN", "GESTOR"],
  },
  {
    href: "/ponto/analise",
    label: "Análise de riscos",
    icon: ShieldAlert,
    roles: ["ADMIN", "GESTOR"],
  },
  {
    href: "/ponto",
    label: "Folha",
    icon: Clock,
    roles: ["ADMIN", "GESTOR", "FOLHA"],
    children: [
      { href: "/afastamentos", label: "Afastamentos", icon: CalendarOff },
      { href: "/ponto/banco-horas", label: "Banco de horas", icon: PiggyBank },
      { href: "/ponto/anual", label: "Relatório anual", icon: CalendarRange },
      { href: "/ponto/mensal", label: "Relatório mensal", icon: FileSpreadsheet },
      { href: "/ponto/passivo", label: "Passivo trabalhista", icon: Scale },
      { href: "/ponto/simulador", label: "Simulador de cenário", icon: FlaskConical },
      { href: "/ponto/correcoes", label: "Histórico de correções", icon: History },
    ],
  },
  {
    href: "/convencoes",
    label: "Convenção coletiva",
    icon: FileText,
    roles: ["ADMIN", "GESTOR"],
  },
  {
    href: "/utilizacao",
    label: "Utilização de veículos",
    icon: Route,
    roles: ["ADMIN", "GESTOR"],
  },
  {
    href: "/telemetria",
    label: "Telemetria",
    icon: Satellite,
    roles: ["ADMIN", "GESTOR"],
  },
  {
    href: "/combustivel",
    label: "Combustível",
    icon: Fuel,
    roles: ["ADMIN", "GESTOR"],
  },
  {
    href: "/usuarios",
    label: "Usuários",
    icon: Users,
    roles: ["ADMIN"],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export default function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname() ?? "";
  const items = NAV.filter((item) => !item.roles || item.roles.includes(role));
  // Grupos abertos manualmente (via chevron) — o grupo do item ativo abre
  // sozinho independente disso, ver `open` abaixo.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(href: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(href)) {
        next.delete(href);
      } else {
        next.add(href);
      }
      return next;
    });
  }

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      {items.map((item) => {
        const Icon = item.icon;
        const hasChildren = !!item.children?.length;
        // Filho ativo tem precedencia sobre o item pai. Pra um item COM
        // filhos, o proprio href so conta como ativo em match EXATO — nao
        // prefixo — senao um item pai com href "/ponto" ficaria marcado
        // (via isActive's startsWith) em qualquer rota "/ponto/*", inclusive
        // uma que e outro item TOP-LEVEL irmao (ex.: "/ponto/analise", que
        // depois de promovido a item proprio nao e mais filho de "Folha",
        // mas ainda comeca com "/ponto/" — bug real visto em producao: os
        // dois itens ficavam destacados ao mesmo tempo).
        const childActive = item.children?.some((c) => isActive(pathname, c.href)) ?? false;
        const selfMatches = hasChildren ? pathname === item.href : isActive(pathname, item.href);
        const selfActive = selfMatches && !childActive;
        const open = childActive || expanded.has(item.href);

        return (
          <div key={item.href}>
            <div
              className={`flex items-center gap-1 rounded-lg pr-1 text-sm font-medium transition-colors ${
                selfActive ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Link href={item.href} prefetch={false} className="flex flex-1 items-center gap-3 px-3 py-2">
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => toggleExpanded(item.href)}
                  className={`rounded p-1 ${selfActive ? "hover:bg-blue-800" : "hover:bg-slate-200"}`}
                  aria-label={open ? `Recolher ${item.label}` : `Expandir ${item.label}`}
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
              )}
            </div>
            {hasChildren && open && (
              <div className="ml-4 mt-1 flex flex-col gap-1 border-l border-slate-200 pl-3">
                {item.children!.map((child) => {
                  const ChildIcon = child.icon;
                  const active = isActive(pathname, child.href);
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      prefetch={false}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        active ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
