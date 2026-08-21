import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { ROLE_LABELS } from "@/lib/permissions";
import { toggleUserActive, deleteUser } from "./actions";
import DeleteUserButton from "./DeleteUserButton";

const ROLE_BADGE_TONE: Record<string, string> = {
  ADMIN: "bg-blue-100 text-blue-700",
  GESTOR: "bg-indigo-100 text-indigo-700",
  FOLHA: "bg-amber-100 text-amber-700",
  MOTORISTA: "bg-slate-100 text-slate-600",
};

export default async function UsuariosPage() {
  const session = await requireRole("ADMIN");

  const users = await prisma.user.findMany({
    where: { companyId: session.companyId },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Usuários"
        subtitle="Contas de acesso ao sistema e seus tipos de permissão."
        actionHref="/usuarios/novo"
        actionLabel="Novo usuário"
      />

      <div className={`${cardClass} p-0 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Tipo de acesso</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Nenhum usuário cadastrado ainda.
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {u.name}
                    {u.id === session.userId && <span className="ml-1.5 text-xs font-normal text-slate-400">(você)</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`${badgeClass} ${ROLE_BADGE_TONE[u.role]}`}>{ROLE_LABELS[u.role]}</span>
                  </td>
                  <td className="px-4 py-3">
                    <form action={toggleUserActive.bind(null, u.id, !u.active)}>
                      <button
                        type="submit"
                        disabled={u.id === session.userId}
                        title={u.id === session.userId ? undefined : u.active ? "Clique para desativar" : "Clique para ativar"}
                        className={`group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                          u.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        } ${
                          u.id === session.userId
                            ? "cursor-not-allowed opacity-60"
                            : "hover:ring-2 hover:ring-offset-1 " + (u.active ? "hover:ring-emerald-300" : "hover:ring-slate-300")
                        }`}
                      >
                        {u.active ? "Ativo" : "Inativo"}
                        {u.id !== session.userId && (
                          <span className="text-[10px] font-normal opacity-0 transition-opacity group-hover:opacity-100">
                            {u.active ? "· desativar" : "· ativar"}
                          </span>
                        )}
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DeleteUserButton
                      action={deleteUser.bind(null, u.id)}
                      userName={u.name}
                      disabled={u.id === session.userId}
                    />
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
