import type { TicketLogCardItemRaw, TicketLogCardStatus, TicketLogExtratoSimplificadoResponse } from "./types";

// Numero maximo de itens pedido por chamada — a frota real tem ~300
// veiculos/cartoes, isso cobre folgado numa unica requisicao (o endpoint nao
// e paginado como page/perPage, so limita por "numeroTransacoes").
const MAX_ITENS = 1000;

// A Azul tem 2 codigoCliente (contas separadas na Ticket Log): 108220 ("Azul
// Transportes") e 241869 ("Azul - Nova Operacao") — confirmado ao vivo que
// os dois usam o mesmo codigoProduto (4, Fleet), apesar do portal rotular o
// segundo como "Cargo" (codigoProduto=5/CAR nao pertence a essa conta).
function codigosCliente(): number[] {
  return (process.env.TICKETLOG_CODIGOS_CLIENTE ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function isTicketLogAvailable(): boolean {
  return Boolean(
    process.env.TICKETLOG_API_BASE_URL &&
      process.env.TICKETLOG_BASIC_AUTH &&
      process.env.TICKETLOG_CODIGO_PRODUTO &&
      codigosCliente().length > 0
  );
}

async function ticketLogPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const baseUrl = process.env.TICKETLOG_API_BASE_URL;
  const auth = process.env.TICKETLOG_BASIC_AUTH;
  if (!baseUrl || !auth) {
    throw new Error("Credenciais da Ticket Log não configuradas (TICKETLOG_API_BASE_URL/TICKETLOG_BASIC_AUTH).");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: auth },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ticket Log respondeu ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as T & { sucesso?: boolean; mensagem?: string };
  if (json.sucesso === false) {
    throw new Error(`Ticket Log: ${json.mensagem ?? "falha desconhecida"}`);
  }
  return json;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapItem(item: TicketLogCardItemRaw): TicketLogCardStatus {
  return {
    numeroCartao: item.numeroCartao,
    plate: item.placa?.trim().toUpperCase() || null,
    situacaoCartao: item.situacao ?? null,
    situacaoVeiculo: item.situacaoVeiculo ?? null,
    saldoCents: item.saldo != null ? Math.round(item.saldo * 100) : null,
    limiteCents: item.limiteAtual != null ? Math.round(item.limiteAtual * 100) : null,
    saldoLitros: item.saldoLitros ?? null,
    limiteLitros: item.limiteAtualLitros ?? null,
    comprasPeriodoCents: item.compras != null ? Math.round(item.compras * 100) : null,
    comprasPeriodoLitros: item.comprasLitros ?? null,
    tipoCombustivelPadrao: item.descricaoTipoCombustivel ?? null,
    tipoFrota: item.descricaoTipoFrota ?? null,
    modeloVeiculo: item.descricaoModeloVeiculo ?? null,
    fabricanteVeiculo: item.veiculoFabricante ?? null,
    cidade: item.veiculoCidade ?? null,
    uf: item.veiculoUF?.trim() || null,
    nomeResponsavel: item.nomeResponsavel ?? null,
    dataAtivacao: toDate(item.dataAtivacao),
  };
}

// Status ATUAL de saldo/limite por cartao, para TODOS os codigoCliente
// configurados (a Azul tem 2 contas separadas na Ticket Log) — nao e
// extrato de transacoes individuais (o endpoint que traria isso,
// /transacoes/search, esta bloqueado por um campo de ordenacao com enum
// interno nao documentado, ver comentario em types.ts). "situacaoCartao: T"
// traz todos os status (ativo/bloqueado/cancelado), pra nao esconder cartao
// com problema.
export async function fetchFuelCardStatuses(): Promise<TicketLogCardStatus[]> {
  const codigoProduto = Number(process.env.TICKETLOG_CODIGO_PRODUTO);
  const clientes = codigosCliente();

  const results = await Promise.all(
    clientes.map((codigoCliente) =>
      ticketLogPost<TicketLogExtratoSimplificadoResponse>("/relatorioExtratoSimplificado/search", {
        codigoCliente,
        codigoProduto,
        situacaoCartao: "T",
        ordem: "P",
        numeroTransacoes: MAX_ITENS,
      })
    )
  );

  return results.flatMap((data) => (data.itens ?? []).map(mapItem));
}
