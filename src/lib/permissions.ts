export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  MOTORISTA: "Motorista",
};

export function canManageCadastros(role: string) {
  return role === "ADMIN" || role === "GESTOR";
}
