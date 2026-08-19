import { omiePercorrerPaginas, type OmieRequestOptions, type PercursoResultado } from "./client";
import { formatDataOmie, normalizeTexto, parseDataOmie, valorParaCents } from "./normalize";
import type { OmieTitulo, OmieTipoTitulo } from "./types";

// Contas a receber e a pagar do Omie.
//
// São dois endpoints/métodos diferentes, mas o formato de resposta é o mesmo
// campo a campo (só muda o nome da chave da lista), então a normalização é
// compartilhada — é também o motivo de os dois dividirem a tabela
// OmieLancamento no schema.

type RecursoFinanceiro = {
  endpoint: string;
  call: string;
  listKey: string;
};

const RECURSOS: Record<OmieTipoTitulo, RecursoFinanceiro> = {
  RECEBER: {
    endpoint: "/financas/contareceber/",
    call: "ListarContasReceber",
    listKey: "conta_receber_cadastro",
  },
  PAGAR: {
    endpoint: "/financas/contapagar/",
    call: "ListarContasPagar",
    listKey: "conta_pagar_cadastro",
  },
};

type TituloBruto = {
  codigo_lancamento_omie?: number | string;
  codigo_cliente_fornecedor?: number | string;
  numero_documento?: string;
  codigo_categoria?: string;
  codigo_departamento?: string;
  codigo_projeto?: number | string;
  data_emissao?: string;
  data_vencimento?: string;
  // A data da baixa aparece com nomes diferentes conforme o método/versão do
  // recurso; todas cobertas aqui porque o campo é o que distingue título pago
  // de título em aberto (base de qualquer análise de fluxo de caixa).
  data_pagamento?: string;
  data_baixa?: string;
  valor_documento?: number | string;
  valor_pago?: number | string;
  status_titulo?: string;
  observacao?: string;
};

function normalizarTitulo(bruto: TituloBruto, tipo: OmieTipoTitulo): OmieTitulo | null {
  const codigoLancamento = normalizeTexto(bruto.codigo_lancamento_omie);
  const dataVencimento = parseDataOmie(bruto.data_vencimento);
  const valorCents = valorParaCents(bruto.valor_documento);
  // Sem código, vencimento ou valor o título não é utilizável: código é a
  // chave de duplicata, vencimento é como tudo é agrupado/filtrado e valor é
  // o dado em si. Descartado (e contado como ignorado pelo sync) em vez de
  // entrar no banco com data inventada.
  if (!codigoLancamento || !dataVencimento || valorCents === null) return null;

  return {
    tipo,
    codigoLancamento,
    codigoClienteFornecedor: normalizeTexto(bruto.codigo_cliente_fornecedor),
    numeroDocumento: normalizeTexto(bruto.numero_documento),
    codigoCategoria: normalizeTexto(bruto.codigo_categoria),
    codigoDepartamento: normalizeTexto(bruto.codigo_departamento),
    codigoProjeto: normalizeTexto(bruto.codigo_projeto),
    dataEmissao: parseDataOmie(bruto.data_emissao),
    dataVencimento,
    dataPagamento: parseDataOmie(bruto.data_pagamento) ?? parseDataOmie(bruto.data_baixa),
    valorCents,
    valorPagoCents: valorParaCents(bruto.valor_pago),
    status: normalizeTexto(bruto.status_titulo),
    observacao: normalizeTexto(bruto.observacao),
  };
}

export type PeriodoTitulos = {
  /** Filtra por data de VENCIMENTO (não de emissão nem de baixa). */
  inicio: Date;
  fim: Date;
};

/**
 * Percorre os títulos do período, entregando cada página já normalizada.
 *
 * O filtro é por vencimento porque é assim que a operação enxerga o
 * financeiro ("o que vence neste mês") e porque é o campo que o Omie indexa
 * nesses métodos — filtrar por emissão deixaria de fora justamente os títulos
 * antigos que foram baixados agora.
 */
export async function percorrerTitulosOmie(
  tipo: OmieTipoTitulo,
  periodo: PeriodoTitulos,
  // `descartados` = registros da página que vieram sem código/vencimento/valor
  // e não puderam ser normalizados. Vai junto pro sync poder contá-los como
  // ignorados em vez de a página sumir sem deixar rastro.
  onPagina: (titulos: OmieTitulo[], descartados: number) => Promise<void>,
  options: OmieRequestOptions = {}
): Promise<PercursoResultado> {
  const recurso = RECURSOS[tipo];
  return omiePercorrerPaginas<TituloBruto>(
    recurso.endpoint,
    recurso.call,
    recurso.listKey,
    {
      filtrar_por_data_de: formatDataOmie(periodo.inicio),
      filtrar_por_data_ate: formatDataOmie(periodo.fim),
      apenas_importado_api: "N",
    },
    async (brutos) => {
      const titulos = brutos
        .map((bruto) => normalizarTitulo(bruto, tipo))
        .filter((t): t is OmieTitulo => t !== null);
      await onPagina(titulos, brutos.length - titulos.length);
    },
    options
  );
}
