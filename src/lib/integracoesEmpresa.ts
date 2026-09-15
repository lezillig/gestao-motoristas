import { prisma } from "@/lib/prisma";

// Trava das integracoes externas (SIAT, Sofit, TiqueTaque, Ituran, LW, Ticket
// Log e o e-mail diario). As credenciais dessas contas ficam em variaveis de
// ambiente e sao UNICAS pro sistema inteiro: pertencem a uma empresa so. Se
// houver uma segunda empresa cadastrada, sincronizar pra ela misturaria os
// dados da conta da primeira (funcionarios, placas, multas) no cadastro da
// segunda. Esta trava deixa as integracoes rodarem apenas pra empresa dona
// das credenciais:
//  - INTEGRACOES_COMPANY_ID definido: so essa empresa;
//  - sem a variavel e com uma unica empresa no banco: essa empresa;
//  - sem a variavel e com duas ou mais empresas: nenhuma, ate configurar.
// Credencial por empresa (cofre de segredos) e outro projeto — so faz sentido
// se o sistema for oferecido a terceiros.

export const MENSAGEM_INTEGRACOES_BLOQUEADAS =
  "Integrações externas bloqueadas: as credenciais configuradas pertencem a outra empresa. Defina INTEGRACOES_COMPANY_ID na Vercel com a empresa dona das credenciais.";

const CACHE_MS = 60_000;
let cache: { id: string | null; expiraEm: number } | null = null;

export async function empresaDasIntegracoes(): Promise<string | null> {
  if (cache && cache.expiraEm > Date.now()) return cache.id;
  const configurada = process.env.INTEGRACOES_COMPANY_ID?.trim();
  let id: string | null;
  if (configurada) {
    // Variavel apontando pra empresa inexistente conta como nao configurada:
    // sem isso, os crons filtrariam zero empresas e registrariam "ok" sem
    // processar nada, escondendo o erro de configuracao.
    const existe = await prisma.company.findUnique({ where: { id: configurada }, select: { id: true } });
    id = existe ? configurada : null;
  } else {
    const empresas = await prisma.company.findMany({ select: { id: true }, take: 2 });
    id = empresas.length === 1 ? empresas[0].id : null;
  }
  cache = { id, expiraEm: Date.now() + CACHE_MS };
  return id;
}

export async function integracoesPermitidas(companyId: string): Promise<boolean> {
  return (await empresaDasIntegracoes()) === companyId;
}

// Pra Server Actions: interrompe com erro quando a empresa da sessao nao e a
// dona das credenciais.
export async function exigirIntegracoesDaEmpresa(companyId: string): Promise<void> {
  if (!(await integracoesPermitidas(companyId))) throw new Error(MENSAGEM_INTEGRACOES_BLOQUEADAS);
}

// Pros crons: filtro do findMany de empresas. Sem empresa dona definida,
// interrompe (o executarCron registra a execucao como erro, com a mensagem).
export async function filtroEmpresaDasIntegracoes(): Promise<{ id: string }> {
  const id = await empresaDasIntegracoes();
  if (!id) throw new Error(MENSAGEM_INTEGRACOES_BLOQUEADAS);
  return { id };
}
