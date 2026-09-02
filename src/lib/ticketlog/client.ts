import type { TicketLogCardStatus, TicketLogExtratoSimplificadoResponse } from "./types";

// Numero maximo de itens pedido por chamada — a frota real tem ~300
// veiculos/cartoes, isso cobre folgado numa unica requisicao (o endpoint nao
// e paginado como page/perPage, so limita por "numeroTransacoes").
const MAX_ITENS = 1000;

export function isTicketLogAvailable(): boolean {
  return Boolean(
    process.env.TICKETLOG_API_BASE_URL &&
      process.env.TICKETLOG_BASIC_AUTH &&
      process.env.TICKETLOG_CODIGO_CLIENTE &&
      process.env.TICKETLOG_CODIGO_PRODUTO
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

// Status ATUAL de saldo/limite por cartao — nao e extrato de transacoes
// individuais (o endpoint que traria isso, /transacoes/search, esta
// bloqueado por um campo de ordenacao com enum interno nao documentado, ver
// comentario em types.ts). "situacaoCartao: T" traz todos os status
// (ativo/bloqueado/cancelado), pra nao esconder cartao com problema.
export async function fetchFuelCardStatuses(): Promise<TicketLogCardStatus[]> {
  const codigoCliente = Number(process.env.TICKETLOG_CODIGO_CLIENTE);
  const codigoProduto = Number(process.env.TICKETLOG_CODIGO_PRODUTO);

  const data = await ticketLogPost<TicketLogExtratoSimplificadoResponse>("/relatorioExtratoSimplificado/search", {
    codigoCliente,
    codigoProduto,
    situacaoCartao: "T",
    ordem: "P",
    numeroTransacoes: MAX_ITENS,
  });

  return (data.itens ?? []).map((item) => ({
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
  }));
}
