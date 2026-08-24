"use client";

import { useActionState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import type { DeleteVehicleState } from "./actions";

export default function DeleteVehicleButton({
  action,
  plate,
}: {
  action: (state: DeleteVehicleState, formData: FormData) => Promise<DeleteVehicleState>;
  plate: string;
}) {
  const [state, formAction, pending] = useActionState<DeleteVehicleState, FormData>(action, {});

  useEffect(() => {
    if (state.error) alert(state.error);
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Excluir o veículo "${plate}" permanentemente? Essa ação não pode ser desfeita.`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        disabled={pending}
        title="Excluir veículo"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </form>
  );
}
