export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  FOLHA: "Folha (acesso restrito)",
  MOTORISTA: "Motorista",
};

export function canManageCadastros(role: string) {
  return role === "ADMIN" || role === "GESTOR";
}

// Gerenciar contas de usuario (criar login, definir role) e uma acao
// sensivel de seguranca — restrita a ADMIN, diferente do resto dos
// cadastros operacionais (que GESTOR tambem pode mexer).
export function canManageUsers(role: string) {
  return role === "ADMIN";
}

// Rota inicial apos login, por role. FOLHA nao tem acesso ao Painel nem ao
// resto do sistema, entao cai direto no relatorio mensal (dentro do seu
// escopo, menu Folha). Qualquer role sem nenhuma pagina liberada (ex.:
// MOTORISTA, sem portal proprio ainda construido) cai em /sem-acesso —
// nunca numa rota que por sua vez exige requireRole, senao vira loop
// infinito de redirect (ver requireRole em lib/auth.ts).
export function defaultRouteForRole(role: string) {
  if (role === "ADMIN" || role === "GESTOR") return "/dashboard";
  if (role === "FOLHA") return "/ponto/mensal";
  return "/sem-acesso";
}
