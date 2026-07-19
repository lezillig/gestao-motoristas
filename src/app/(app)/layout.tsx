import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AppShell from "@/components/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const company = await prisma.company.findUnique({
    where: { id: session.companyId },
  });

  return (
    <AppShell
      name={session.name}
      role={session.role}
      orgName={company?.name ?? "Gestão de Motoristas"}
    >
      {children}
    </AppShell>
  );
}
