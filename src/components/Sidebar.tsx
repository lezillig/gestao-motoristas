"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[];
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
    href: "/ponto",
    label: "Ponto",
    icon: Clock,
    roles: ["ADMIN", "GESTOR"],
  },
  {
    href: "/ponto/analise",
    label: "Análise de riscos",
    icon: ShieldAlert,
    roles: ["ADMIN", "GESTOR"],
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
];

export default function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = NAV.filter((item) => !item.roles || item.roles.includes(role));
  // Quando a rota atual casa com mais de um href (ex.: /ponto/analise casa
  // com "/ponto" e com "/ponto/analise"), so o mais especifico fica ativo.
  const activeHref = [...items]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname?.startsWith(item.href + "/"))?.href;

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      {items.map((item) => {
        const active = item.href === activeHref;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-blue-700 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
