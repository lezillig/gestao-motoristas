"use client";

import { Trash2 } from "lucide-react";

export default function DeleteUserButton({
  action,
  userName,
  disabled,
}: {
  action: () => Promise<void>;
  userName: string;
  disabled?: boolean;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Excluir o usuário "${userName}" permanentemente? Essa ação não pode ser desfeita.`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        disabled={disabled}
        title="Excluir usuário"
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 ${
          disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-slate-400" : ""
        }`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </form>
  );
}
