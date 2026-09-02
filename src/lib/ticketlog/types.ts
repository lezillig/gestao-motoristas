// Formato cru da API REST da Ticket Log (base
// https://srv1.ticketlog.com.br/ticketlog-servicos/ebs/), descoberto ao vivo
// (2026-09-01) — a documentacao publica (goodmanager.com.br) descreve os
// endpoints mas varios nomes de campo reais divergem do documentado (ex.:
// "situacao" no corpo nao funciona, o campo real e "situacaoCartao"; "cd_ordem"
// tambem nao funciona, o campo real e "ordem" — mas so aceita um enum interno
// cujos valores validos nao conseguimos descobrir; por isso o sync abaixo
// usa so /relatorioExtratoSimplificado/search, que funciona sem esse campo
// quando omitido corretamente configurado).
export type TicketLogCardItemRaw = {
  placa?: string | null;
  numeroCartao: string;
  situacao?: string | null; // do CARTAO nesta resposta (nao confundir com o campo de request)
  situacaoVeiculo?: string | null;
  saldo?: number | null;
  limiteAtual?: number | null;
  saldoLitros?: number | null;
  limiteAtualLitros?: number | null;
  compras?: number | null;
  comprasLitros?: number | null;
  descricaoTipoCombustivel?: string | null;
  descricaoTipoFrota?: string | null;
  descricaoModeloVeiculo?: string | null;
  veiculoFabricante?: string | null;
  veiculoCidade?: string | null;
  veiculoUF?: string | null;
  nomeResponsavel?: string | null;
  dataAtivacao?: string | null; // yyyy-MM-dd
};

export type TicketLogExtratoSimplificadoResponse = {
  itens?: TicketLogCardItemRaw[];
  sucesso?: boolean;
  codigoErro?: string;
  mensagem?: string;
};

export type TicketLogCardStatus = {
  numeroCartao: string;
  plate: string | null;
  situacaoCartao: string | null;
  situacaoVeiculo: string | null;
  saldoCents: number | null;
  limiteCents: number | null;
  saldoLitros: number | null;
  limiteLitros: number | null;
  comprasPeriodoCents: number | null;
  comprasPeriodoLitros: number | null;
  tipoCombustivelPadrao: string | null;
  tipoFrota: string | null;
  modeloVeiculo: string | null;
  fabricanteVeiculo: string | null;
  cidade: string | null;
  uf: string | null;
  nomeResponsavel: string | null;
  dataAtivacao: Date | null;
};
