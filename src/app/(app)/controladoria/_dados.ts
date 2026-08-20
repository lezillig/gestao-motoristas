import { requireRole } from "@/lib/auth";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { carregarContexto } from "@/lib/controladoria/contexto";
import type { ContextoAuditoria } from "@/lib/controladoria/types";
import type { SessionPayload } from "@/lib/auth";

// Porta de entrada única das telas da Controladoria.
//
// Duas coisas ficam aqui, e não repetidas em cada página: (1) a checagem de
// permissão — esquecer o requireRole numa única rota abriria o financeiro
// inteiro para qualquer usuário autenticado; (2) o carregamento do contexto,
// que é exatamente o MESMO que os agentes e o relatório usam. Se a tela
// montasse os números por conta própria, uma divergência entre o painel e o
// e-mail seria só questão de tempo — e bastaria uma para o usuário perder a
// confiança no módulo.
export async function contextoDaPagina(): Promise<{ session: SessionPayload; ctx: ContextoAuditoria }> {
  const session = await requireRole("ADMIN", "GESTOR", "CONTROLADORIA");
  const ctx = await carregarContexto(session.companyId, dataReferenciaPadrao());
  return { session, ctx };
}

// Páginas que só precisam da sessão (listagens que consultam o banco direto,
// como relatórios e histórico) usam esta, evitando o custo de montar o
// contexto inteiro.
export async function sessaoControladoria(): Promise<SessionPayload> {
  return requireRole("ADMIN", "GESTOR", "CONTROLADORIA");
}
