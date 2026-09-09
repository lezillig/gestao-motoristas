// Campos confirmados reais em GET /multas/buscarMulta/{placa} (2026-09-09) —
// a LW devolve 30+ campos por multa (objeto MultasBusca), so os usados por
// este app viram propriedade tipada aqui; o resto fica preservado em
// Multa.rawJson (ver prisma/schema.prisma).
export interface LwMultaDTO {
  id: string;
  ait: string | null;
  descricao: string | null;
  artigo: string | null;
  orgao: string | null;
  cidade: string | null;
  uf: string | null;
  renavam: string | null;
  dataInfracao: string | null; // "yyyy-MM-dd HH:mm:ss.S"
  horaInfracao: string | null; // "HH:mm"
  dataVencimento: string | null;
  apCondutorDataVencimento: string | null;
  valor: string | null; // string decimal, ex. "195.23"
  pontuacao: string | null; // string numerica, ex. "5"
  situacao: string | null; // "IMPOSTO" | "NOTIFICADO" | "Encerrado" | "Devedora" | "Cancelada"
  statusPagamento: number | null;
  pagoLW: boolean | null;
  placa: string;
  [key: string]: unknown;
}

// GET /veiculos/todosVeiculos (VeiculoLwAppDTO) — usado como fonte de
// verdade de "sob qual grafia este veiculo esta cadastrado do lado da LW",
// ver src/lib/lw/plateMatch.ts.
export interface LwVeiculoDTO {
  id_veiculo: number;
  placa: string;
  placaMercosul: string | null;
  renavam: string | null;
  status: string | null;
  marca_modelo: string | null;
  [key: string]: unknown;
}

export interface LwCondutorDTO {
  cpf: string;
  nome: string;
  data_nascimento: string | null;
  data_validade: string | null;
  numero_registro: string | null;
  numero_registro_pid: string | null;
  data_vencimento_pid: string | null;
  email: string | null;
  imagemCnh: boolean;
  passaporte: string | null;
  rg: string | null;
  uf_registro_cnh: string | null;
}
