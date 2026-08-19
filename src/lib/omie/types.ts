// Tipos normalizados da integração com o Omie.
//
// Deliberadamente separados do formato cru da API (que vive em cada módulo de
// recurso, ex. clientes.ts/financeiro.ts): o resto do sistema fala destes
// tipos, em camelCase e com valores já convertidos (data como `Date`, dinheiro
// como centavos inteiros), e nunca do snake_case em português da API. Mesmo
// desenho de src/lib/tiquetaque/types.ts.

export type OmieCliente = {
  /** `codigo_cliente_omie`, como string — ver comentário em Cliente.omieCodigoCliente. */
  codigo: string;
  /** `codigo_cliente_integracao` — código que o SISTEMA de origem definiu, quando o cadastro veio de integração. */
  codigoIntegracao: string | null;
  razaoSocial: string;
  nomeFantasia: string | null;
  /** Só dígitos (sem pontuação), pronto pra comparar com Cliente.cnpjCpf. */
  cnpjCpf: string | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  estado: string | null;
  /** `inativo` no Omie vem como "S"/"N" — normalizado pra booleano aqui. */
  inativo: boolean;
  /** Tags do cadastro no Omie (`tags[].tag`), úteis pra separar cliente de fornecedor. */
  tags: string[];
};

/** Espelha o enum OmieTipoLancamento do schema (RECEBER = contas a receber). */
export type OmieTipoTitulo = "RECEBER" | "PAGAR";

export type OmieTitulo = {
  tipo: OmieTipoTitulo;
  /** `codigo_lancamento_omie` — critério de duplicata do sync. */
  codigoLancamento: string;
  /** `codigo_cliente_fornecedor` — casa com OmieCliente.codigo. */
  codigoClienteFornecedor: string | null;
  numeroDocumento: string | null;
  codigoCategoria: string | null;
  codigoDepartamento: string | null;
  codigoProjeto: string | null;
  dataEmissao: Date | null;
  dataVencimento: Date;
  /** Data da baixa efetiva; nula enquanto o título está em aberto. */
  dataPagamento: Date | null;
  valorCents: number;
  valorPagoCents: number | null;
  /** `status_titulo` cru ("ATRASADO", "A VENCER", "RECEBIDO", "PAGO"...). */
  status: string | null;
  observacao: string | null;
};

/** Uma página de resposta de qualquer endpoint de listagem do Omie. */
export type OmiePagina<T> = {
  pagina: number;
  totalDePaginas: number;
  totalDeRegistros: number;
  registros: T[];
};
