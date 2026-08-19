import {
  omiePercorrerPaginas,
  omieRequest,
  type OmieRequestOptions,
  type PercursoResultado,
} from "./client";
import { normalizeCnpjCpf, normalizeTexto, simNaoParaBoolean } from "./normalize";
import type { OmieCliente } from "./types";

// Cadastro de clientes/fornecedores do Omie.
// No Omie os dois vivem na MESMA tabela (um fornecedor é um "cliente" com
// tag/flag diferente), por isso o endpoint se chama /geral/clientes/ e traz os
// dois — quem separa é quem consome.

const ENDPOINT = "/geral/clientes/";
const LIST_KEY = "clientes_cadastro";

type ClienteBruto = {
  codigo_cliente_omie?: number | string;
  codigo_cliente_integracao?: string;
  razao_social?: string;
  nome_fantasia?: string;
  cnpj_cpf?: string;
  email?: string;
  telefone1_ddd?: string;
  telefone1_numero?: string;
  cidade?: string;
  estado?: string;
  inativo?: string;
  tags?: { tag?: string }[];
};

function normalizarCliente(bruto: ClienteBruto): OmieCliente | null {
  const codigo = normalizeTexto(bruto.codigo_cliente_omie);
  const razaoSocial = normalizeTexto(bruto.razao_social);
  // Sem código ou sem razão social o registro não serve pra nada aqui (não dá
  // pra identificar nem exibir) — descartado em vez de virar linha órfã.
  if (!codigo || !razaoSocial) return null;

  const ddd = normalizeTexto(bruto.telefone1_ddd);
  const numero = normalizeTexto(bruto.telefone1_numero);

  return {
    codigo,
    codigoIntegracao: normalizeTexto(bruto.codigo_cliente_integracao),
    razaoSocial,
    nomeFantasia: normalizeTexto(bruto.nome_fantasia),
    cnpjCpf: normalizeCnpjCpf(bruto.cnpj_cpf),
    email: normalizeTexto(bruto.email),
    telefone: numero ? `${ddd ?? ""}${numero}` : null,
    cidade: normalizeTexto(bruto.cidade),
    estado: normalizeTexto(bruto.estado),
    inativo: simNaoParaBoolean(bruto.inativo),
    tags: (bruto.tags ?? []).map((t) => normalizeTexto(t.tag)).filter((t): t is string => t !== null),
  };
}

/**
 * Percorre o cadastro de clientes do Omie página a página, entregando cada
 * página já normalizada. Não acumula tudo em memória de propósito — ver
 * omiePercorrerPaginas.
 */
export async function percorrerClientesOmie(
  // `descartados` = registros da página sem código ou razão social, que não
  // puderam ser normalizados — contados como ignorados pelo sync.
  onPagina: (clientes: OmieCliente[], descartados: number) => Promise<void>,
  options: OmieRequestOptions = {}
): Promise<PercursoResultado> {
  return omiePercorrerPaginas<ClienteBruto>(
    ENDPOINT,
    "ListarClientes",
    LIST_KEY,
    // `apenas_importado_api: "N"` = traz o cadastro inteiro, não só o que foi
    // criado por API. É o que se quer aqui: os clientes reais foram
    // cadastrados por gente, dentro do Omie.
    { apenas_importado_api: "N" },
    async (brutos) => {
      const clientes = brutos.map(normalizarCliente).filter((c): c is OmieCliente => c !== null);
      await onPagina(clientes, brutos.length - clientes.length);
    },
    options
  );
}

/**
 * Consulta um cliente específico. Aceita o código do Omie ou o CNPJ/CPF —
 * usado pela tela de vínculo manual, quando o casamento automático não achou
 * o par de um cliente do cadastro local.
 */
export async function consultarClienteOmie(
  chave: { codigo: string } | { cnpjCpf: string },
  options: OmieRequestOptions = {}
): Promise<OmieCliente | null> {
  const param =
    "codigo" in chave
      ? { codigo_cliente_omie: Number(chave.codigo) }
      : { cnpj_cpf: chave.cnpjCpf };
  const bruto = await omieRequest<ClienteBruto>(ENDPOINT, "ConsultarCliente", param, options);
  return normalizarCliente(bruto);
}
