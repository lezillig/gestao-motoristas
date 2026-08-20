export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  FOLHA: "Folha (acesso restrito)",
  CONTROLADORIA: "Controladoria (acesso restrito)",
  MOTORISTA: "Motorista",
};

export function canManageCadastros(role: string) {
  return role === "ADMIN" || role === "GESTOR";
}

// Quem enxerga o modulo de Controladoria. CONTROLADORIA e um perfil de
// dominio unico (mesma filosofia de FOLHA): ve o financeiro inteiro e nada de
// ponto, escala ou dado pessoal de motorista — o que permite dar acesso ao
// financeiro/contabilidade, inclusive terceirizado, sem expor dado trabalhista.
export function canViewControladoria(role: string) {
  return role === "ADMIN" || role === "GESTOR" || role === "CONTROLADORIA";
}

// Tratar achado, mudar meta do BSC, alterar parametro do modelo de gestao e
// confirmar vinculo de centro de custo. Separado da leitura de proposito: num
// modulo de auditoria, "ver" e "poder desligar o alerta" nao podem ser a mesma
// permissao. GESTOR le tudo, mas quem opera a controladoria e quem trata.
export function canManageControladoria(role: string) {
  return role === "ADMIN" || role === "CONTROLADORIA";
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
  if (role === "CONTROLADORIA") return "/controladoria";
  return "/sem-acesso";
}
