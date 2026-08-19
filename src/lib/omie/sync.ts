import type { OmieRecurso, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { percorrerClientesOmie } from "./clientes";
import { percorrerTitulosOmie, type PeriodoTitulos } from "./financeiro";
import { chaveNome } from "./normalize";
import type { OmieCliente, OmieTipoTitulo, OmieTitulo } from "./types";
import type { OmieRequestOptions } from "./client";

// Reconciliação Omie -> banco local.
//
// Regra geral, igual à da importação do TiqueTaque: o sync NUNCA apaga nem
// sobrescreve o que foi cadastrado à mão aqui. Ele preenche o que está vazio,
// atualiza o que ele mesmo trouxe e, quando não consegue decidir com
// segurança, deixa como está e conta o registro como ignorado — visível no
// resultado da execução, em vez de silencioso.

export type SyncResultado = {
  criados: number;
  atualizados: number;
  ignorados: number;
  paginasLidas: number;
  /**
   * A leitura parou antes do fim por falta de orçamento de tempo (execução em
   * função serverless tem teto duro). Não é erro: o que entrou está correto,
   * só está incompleto — rodar de novo continua sem duplicar.
   */
  interrompidoPorTempo: boolean;
  /** Preenchido quando a execução falhou no meio; os contadores refletem o que entrou até ali. */
  erro: string | null;
};

export type SyncOptions = OmieRequestOptions & {
  /** "MANUAL" (disparado na tela) ou "CRON". */
  origem?: string;
  executadoPorUserId?: string | null;
};

// Executa o corpo do sync já gravando OmieSyncLog: cria a linha antes de
// começar e a fecha no fim, com contadores, tenha dado certo ou não (uma
// execução que falhou no meio é exatamente a que mais interessa no
// histórico). O erro é re-lançado depois de registrado — quem chamou decide
// como mostrar.
async function comRegistro(
  companyId: string,
  recurso: OmieRecurso,
  periodo: { inicio: Date; fim: Date } | null,
  options: SyncOptions,
  executar: (contadores: SyncResultado) => Promise<void>
): Promise<SyncResultado> {
  const log = await prisma.omieSyncLog.create({
    data: {
      companyId,
      recurso,
      origem: options.origem ?? "MANUAL",
      executadoPorUserId: options.executadoPorUserId ?? null,
      periodoInicio: periodo?.inicio ?? null,
      periodoFim: periodo?.fim ?? null,
    },
  });

  const contadores: SyncResultado = {
    criados: 0,
    atualizados: 0,
    ignorados: 0,
    paginasLidas: 0,
    interrompidoPorTempo: false,
    erro: null,
  };

  try {
    await executar(contadores);
  } catch (e) {
    contadores.erro = e instanceof Error ? e.message : String(e);
  }

  await prisma.omieSyncLog.update({
    where: { id: log.id },
    data: {
      criados: contadores.criados,
      atualizados: contadores.atualizados,
      ignorados: contadores.ignorados,
      paginasLidas: contadores.paginasLidas,
      interrompido: contadores.interrompidoPorTempo,
      erro: contadores.erro,
      concluidoEm: new Date(),
    },
  });

  return contadores;
}

// ---------- Clientes ----------

export type SyncClientesOptions = SyncOptions & {
  /**
   * Cria no cadastro local os clientes do Omie que não têm par aqui.
   *
   * Padrão `false` de propósito: o cadastro de Cliente daqui é a lista de
   * CENTROS DE CUSTO/contratos (algumas dezenas), enquanto o cadastro do Omie
   * traz clientes E fornecedores da empresa inteira (facilmente centenas).
   * Importar tudo transformaria a tela de Clientes — que alimenta o vínculo
   * dos motoristas e as análises de custo por contrato — numa lista
   * impraticável. Quem quiser puxar um cliente novo do Omie liga isso
   * explicitamente na tela.
   */
  criarNovos?: boolean;
};

type ClienteLocal = {
  id: string;
  nome: string;
  cnpjCpf: string | null;
  omieCodigoCliente: string | null;
  omieRazaoSocial: string | null;
  omieNomeFantasia: string | null;
};

/**
 * Casa um cliente do Omie com o cadastro local, na ordem: código do Omie já
 * gravado > CNPJ/CPF > nome normalizado.
 *
 * O casamento por nome é o único heurístico e por isso é o último: só vale
 * quando o cliente local não tem CNPJ preenchido (senão o CNPJ já teria
 * decidido) e só quando bate um único candidato — dois clientes locais com o
 * mesmo nome normalizado devolvem "ambíguo" e o registro é ignorado, em vez
 * de vincular o financeiro do contrato errado.
 */
function casarCliente(
  omie: OmieCliente,
  porCodigo: Map<string, ClienteLocal>,
  porCnpj: Map<string, ClienteLocal[]>,
  porNome: Map<string, ClienteLocal[]>
): { cliente: ClienteLocal } | { ambiguo: true } | null {
  const porCodigoMatch = porCodigo.get(omie.codigo);
  if (porCodigoMatch) return { cliente: porCodigoMatch };

  if (omie.cnpjCpf) {
    const candidatos = porCnpj.get(omie.cnpjCpf) ?? [];
    if (candidatos.length === 1) return { cliente: candidatos[0] };
    if (candidatos.length > 1) return { ambiguo: true };
  }

  const candidatosPorNome = [
    ...(porNome.get(chaveNome(omie.razaoSocial)) ?? []),
    ...(omie.nomeFantasia ? porNome.get(chaveNome(omie.nomeFantasia)) ?? [] : []),
  ];
  const unicos = [...new Map(candidatosPorNome.map((c) => [c.id, c])).values()];
  if (unicos.length === 1) return { cliente: unicos[0] };
  if (unicos.length > 1) return { ambiguo: true };

  return null;
}

export async function syncClientesOmie(
  companyId: string,
  options: SyncClientesOptions = {}
): Promise<SyncResultado> {
  return comRegistro(companyId, "CLIENTES", null, options, async (contadores) => {
    const locais: ClienteLocal[] = await prisma.cliente.findMany({
      where: { companyId },
      select: {
        id: true,
        nome: true,
        cnpjCpf: true,
        omieCodigoCliente: true,
        omieRazaoSocial: true,
        omieNomeFantasia: true,
      },
    });

    const porCodigo = new Map<string, ClienteLocal>();
    const porCnpj = new Map<string, ClienteLocal[]>();
    const porNome = new Map<string, ClienteLocal[]>();
    for (const local of locais) {
      if (local.omieCodigoCliente) porCodigo.set(local.omieCodigoCliente, local);
      if (local.cnpjCpf) {
        porCnpj.set(local.cnpjCpf, [...(porCnpj.get(local.cnpjCpf) ?? []), local]);
      }
      const chave = chaveNome(local.nome);
      porNome.set(chave, [...(porNome.get(chave) ?? []), local]);
    }
    // Nomes locais já usados — o cadastro tem @@unique([companyId, nome]), então
    // criar um cliente novo com nome repetido explodiria a execução inteira.
    const nomesUsados = new Set(locais.map((l) => chaveNome(l.nome)));

    const resumo = await percorrerClientesOmie(async (clientes, descartados) => {
      contadores.ignorados += descartados;

      for (const omie of clientes) {
        const match = casarCliente(omie, porCodigo, porCnpj, porNome);

        if (match && "ambiguo" in match) {
          contadores.ignorados++;
          continue;
        }

        if (!match) {
          if (!options.criarNovos || omie.inativo) {
            contadores.ignorados++;
            continue;
          }
          const nome = omie.nomeFantasia ?? omie.razaoSocial;
          if (nomesUsados.has(chaveNome(nome))) {
            // Nome já existe no cadastro mas não casou acima (ex. o local tem
            // outro CNPJ) — criar quebraria a unicidade, então fica pro
            // vínculo manual.
            contadores.ignorados++;
            continue;
          }
          const criado = await prisma.cliente.create({
            data: {
              companyId,
              nome,
              cnpjCpf: omie.cnpjCpf,
              omieCodigoCliente: omie.codigo,
              omieRazaoSocial: omie.razaoSocial,
              omieNomeFantasia: omie.nomeFantasia,
              omieSyncedAt: new Date(),
            },
            select: {
              id: true,
              nome: true,
              cnpjCpf: true,
              omieCodigoCliente: true,
              omieRazaoSocial: true,
              omieNomeFantasia: true,
            },
          });
          porCodigo.set(omie.codigo, criado);
          nomesUsados.add(chaveNome(nome));
          contadores.criados++;
          continue;
        }

        const local = match.cliente;
        // Cliente local já vinculado a OUTRO código do Omie: não rouba o
        // vínculo (dois cadastros do Omie apontando pro mesmo cliente local é
        // caso real — matriz e filial com a mesma razão social).
        if (local.omieCodigoCliente && local.omieCodigoCliente !== omie.codigo) {
          contadores.ignorados++;
          continue;
        }

        const data: Prisma.ClienteUpdateInput = {};
        if (local.omieCodigoCliente !== omie.codigo) data.omieCodigoCliente = omie.codigo;
        // CNPJ local preenchido não é sobrescrito: quem digitou aqui pode ter
        // corrigido um cadastro errado do ERP.
        if (!local.cnpjCpf && omie.cnpjCpf) data.cnpjCpf = omie.cnpjCpf;
        if (local.omieRazaoSocial !== omie.razaoSocial) data.omieRazaoSocial = omie.razaoSocial;
        if (local.omieNomeFantasia !== omie.nomeFantasia) data.omieNomeFantasia = omie.nomeFantasia;

        if (Object.keys(data).length === 0) {
          // Nada mudou de fato — só carimba a data do sync, sem contar como
          // atualização (senão todo sync reportaria "N atualizados" mesmo sem
          // nenhuma mudança real, e o número perde o sentido).
          await prisma.cliente.update({
            where: { id: local.id },
            data: { omieSyncedAt: new Date() },
          });
          continue;
        }

        await prisma.cliente.update({
          where: { id: local.id },
          data: { ...data, omieSyncedAt: new Date() },
        });
        porCodigo.set(omie.codigo, { ...local, omieCodigoCliente: omie.codigo });
        contadores.atualizados++;
      }
    }, options);

    contadores.paginasLidas = resumo.paginasLidas;
    contadores.interrompidoPorTempo = resumo.interrompidoPorTempo;
  });
}

// ---------- Contas a receber / a pagar ----------

const RECURSO_POR_TIPO: Record<OmieTipoTitulo, OmieRecurso> = {
  RECEBER: "CONTAS_RECEBER",
  PAGAR: "CONTAS_PAGAR",
};

/** Campos que o sync reescreve quando o título muda no Omie depois de importado. */
function dadosDoTitulo(titulo: OmieTitulo, clienteLocal: ClienteLocal | undefined) {
  return {
    clienteId: clienteLocal?.id ?? null,
    omieCodigoClienteFornecedor: titulo.codigoClienteFornecedor,
    // O método de listagem de títulos devolve só o CÓDIGO da outra ponta, sem
    // nome — o nome vem do cadastro de clientes já sincronizado. Por isso o
    // sync de clientes roda antes na tela e no cron: um título importado antes
    // do cliente correspondente fica sem nome até o próximo sync (nunca com
    // nome errado).
    nomeClienteFornecedor: clienteLocal?.omieRazaoSocial ?? clienteLocal?.nome ?? null,
    cnpjCpfClienteFornecedor: clienteLocal?.cnpjCpf ?? null,
    numeroDocumento: titulo.numeroDocumento,
    codigoCategoria: titulo.codigoCategoria,
    codigoDepartamento: titulo.codigoDepartamento,
    codigoProjeto: titulo.codigoProjeto,
    dataEmissao: titulo.dataEmissao,
    dataVencimento: titulo.dataVencimento,
    dataPagamento: titulo.dataPagamento,
    valorCents: titulo.valorCents,
    valorPagoCents: titulo.valorPagoCents,
    status: titulo.status,
    observacao: titulo.observacao,
  };
}

/** Só conta como atualização o que realmente mudou — ver comentário análogo no sync de clientes. */
function tituloMudou(
  atual: Record<string, unknown>,
  novo: ReturnType<typeof dadosDoTitulo>
): boolean {
  for (const [campo, valor] of Object.entries(novo)) {
    const anterior = atual[campo];
    if (valor instanceof Date || anterior instanceof Date) {
      const a = valor instanceof Date ? valor.getTime() : null;
      const b = anterior instanceof Date ? anterior.getTime() : null;
      if (a !== b) return true;
      continue;
    }
    if (anterior !== valor) return true;
  }
  return false;
}

export async function syncTitulosOmie(
  companyId: string,
  tipo: OmieTipoTitulo,
  periodo: PeriodoTitulos,
  options: SyncOptions = {}
): Promise<SyncResultado> {
  return comRegistro(
    companyId,
    RECURSO_POR_TIPO[tipo],
    { inicio: periodo.inicio, fim: periodo.fim },
    options,
    async (contadores) => {
      const clientesVinculados: ClienteLocal[] = await prisma.cliente.findMany({
        where: { companyId, omieCodigoCliente: { not: null } },
        select: {
          id: true,
          nome: true,
          cnpjCpf: true,
          omieCodigoCliente: true,
          omieRazaoSocial: true,
          omieNomeFantasia: true,
        },
      });
      const clientePorCodigoOmie = new Map(
        clientesVinculados.map((c) => [c.omieCodigoCliente as string, c])
      );

      const resumo = await percorrerTitulosOmie(
        tipo,
        periodo,
        async (titulos, descartados) => {
          contadores.ignorados += descartados;
          if (titulos.length === 0) return;

          // Uma consulta por página (não por título) pra saber o que já existe.
          const existentes = await prisma.omieLancamento.findMany({
            where: {
              companyId,
              tipo,
              omieCodigoLancamento: { in: titulos.map((t) => t.codigoLancamento) },
            },
          });
          const existentePorCodigo = new Map(existentes.map((e) => [e.omieCodigoLancamento, e]));

          const novos: Prisma.OmieLancamentoCreateManyInput[] = [];
          for (const titulo of titulos) {
            const clienteLocal = titulo.codigoClienteFornecedor
              ? clientePorCodigoOmie.get(titulo.codigoClienteFornecedor)
              : undefined;
            const dados = dadosDoTitulo(titulo, clienteLocal);
            const existente = existentePorCodigo.get(titulo.codigoLancamento);

            if (!existente) {
              novos.push({
                companyId,
                tipo,
                omieCodigoLancamento: titulo.codigoLancamento,
                ...dados,
              });
              continue;
            }

            if (!tituloMudou(existente as unknown as Record<string, unknown>, dados)) {
              await prisma.omieLancamento.update({
                where: { id: existente.id },
                data: { syncedAt: new Date() },
              });
              continue;
            }

            await prisma.omieLancamento.update({
              where: { id: existente.id },
              data: { ...dados, syncedAt: new Date() },
            });
            contadores.atualizados++;
          }

          if (novos.length > 0) {
            // skipDuplicates protege contra o mesmo título aparecer duas vezes
            // na mesma leitura (páginas do Omie podem repetir registro quando
            // algo é alterado no ERP durante a paginação).
            const criados = await prisma.omieLancamento.createMany({
              data: novos,
              skipDuplicates: true,
            });
            contadores.criados += criados.count;
            contadores.ignorados += novos.length - criados.count;
          }
        },
        options
      );

      contadores.paginasLidas = resumo.paginasLidas;
      contadores.interrompidoPorTempo = resumo.interrompidoPorTempo;
    }
  );
}
