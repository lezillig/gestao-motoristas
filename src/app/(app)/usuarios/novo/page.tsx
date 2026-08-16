import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import { requireRole } from "@/lib/auth";
import UserForm from "../UserForm";
import { createUser } from "../actions";

export default async function NovoUsuarioPage() {
  await requireRole("ADMIN");

  return (
    <div className="max-w-lg">
      <PageHeader title="Novo usuário" />
      <div className={cardClass}>
        <UserForm action={createUser} />
      </div>
    </div>
  );
}
