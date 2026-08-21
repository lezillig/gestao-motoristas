import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import UserForm from "../UserForm";
import { updateUser } from "../actions";

export default async function EditarUsuarioPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("ADMIN");
  const { id } = await params;

  // Filtrado por empresa, não só por id: sem isso, um id de outra empresa
  // colado na URL abriria a conta de um terceiro para edição.
  const usuario = await prisma.user.findFirst({
    where: { id, companyId: session.companyId },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!usuario) notFound();

  return (
    <div className="max-w-lg">
      <PageHeader
        title="Editar usuário"
        subtitle={usuario.active ? undefined : "Esta conta está desativada e não consegue entrar no sistema."}
      />
      <div className={cardClass}>
        <UserForm
          action={updateUser.bind(null, usuario.id)}
          valores={{ name: usuario.name, email: usuario.email, role: usuario.role }}
          edicao
        />
      </div>
    </div>
  );
}
