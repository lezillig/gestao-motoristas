import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  registrarSyncLog,
  syncFuelSuppliesIntoDb,
  syncMaintenancesIntoDb,
  syncOdometerIntoDb,
  syncVehiclesIntoDb,
} from "@/lib/sofit/importCore";
import {
  normalizeFuelSupply,
  normalizeMaintenance,
  normalizeOdometerReading,
  normalizeVehicle,
  type NormalizeResult,
} from "@/lib/sofit/normalize";
import { SOFIT_ENTITIES, type SofitEntity, type SofitSyncEntityResult } from "@/lib/sofit/types";

// Ponta RECEPTORA da integracao: o Sofit (ou um intermediario contratado)
// empurra os dados pra ca em vez de esperarmos o agendamento diario. Serve
// pro caso, comum em implantacao de frota, de o cliente ja ter um envio
// configurado no Sofit e nao querer (ou nao poder) liberar a API de consulta
// pra nos — o resto do sistema nao muda: o corpo passa exatamente pelos
// mesmos normalizadores e pelas mesmas funcoes de gravacao do sync ativo.
//
// Autenticacao por segredo compartilhado no header Authorization, igual as
// rotas de cron (Bearer). Sem SOFIT_WEBHOOK_SECRET configurado, a rota fica
// desligada e responde 404 — nao 401: pra quem sonda a URL de fora, uma
// integracao nao habilitada nao deve nem confirmar que existe.
export const maxDuration = 60;

// Teto de itens por requisicao: lote maior que isso deve ser paginado pelo
// emissor. Protege a funcao serverless (60s) e o banco de um POST unico com
// centenas de milhares de linhas.
const MAX_ITENS = 1000;

function autorizado(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  // Comparacao de tempo constante: comparar segredo com === vaza, pelo tempo
  // de resposta, quantos caracteres iniciais o atacante acertou.
  const a = Buffer.from(header);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseEntidade(value: unknown): SofitEntity | null {
  if (typeof value !== "string") return null;
  const normalizado = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  // Aceita singular e plural ("abastecimento"/"abastecimentos"), que e como
  // sistemas diferentes nomeiam o mesmo evento.
  const candidato = normalizado.endsWith("S") ? normalizado : `${normalizado}S`;
  if (normalizado === "ODOMETRO" || candidato === "ODOMETROS") return "ODOMETRO";
  return SOFIT_ENTITIES.find((entidade) => entidade === candidato) ?? null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.SOFIT_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!autorizado(req, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição não é JSON válido." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Envie um objeto JSON { "tipo": ..., "dados": [...] }.' }, { status: 400 });
  }

  const payload = body as { tipo?: unknown; dados?: unknown; companyId?: unknown };
  const entidade = parseEntidade(payload.tipo);
  if (!entidade) {
    return NextResponse.json(
      { error: `Campo "tipo" inválido. Use um de: ${SOFIT_ENTITIES.join(", ")}.` },
      { status: 400 }
    );
  }

  const dados = payload.dados;
  if (!Array.isArray(dados)) {
    return NextResponse.json({ error: 'Campo "dados" deve ser uma lista de registros.' }, { status: 400 });
  }
  if (dados.length > MAX_ITENS) {
    return NextResponse.json(
      { error: `Lote com ${dados.length} itens excede o limite de ${MAX_ITENS} por requisição.` },
      { status: 413 }
    );
  }

  // Empresa de destino: com uma unica empresa cadastrada (o caso hoje), o
  // emissor nao precisa saber nada de multi-tenant. Com mais de uma, o
  // companyId passa a ser obrigatorio — nunca adivinhamos o tenant.
  const companies = await prisma.company.findMany({ where: { active: true }, select: { id: true } });
  let companyId: string;
  if (typeof payload.companyId === "string" && payload.companyId) {
    if (!companies.some((c) => c.id === payload.companyId)) {
      return NextResponse.json({ error: "companyId desconhecido." }, { status: 400 });
    }
    companyId = payload.companyId;
  } else if (companies.length === 1) {
    companyId = companies[0].id;
  } else {
    return NextResponse.json(
      { error: "Mais de uma empresa cadastrada — informe companyId no corpo da requisição." },
      { status: 400 }
    );
  }

  const started = Date.now();
  const erros: string[] = [];

  function coletar<T>(normalize: (raw: unknown) => NormalizeResult<T>): T[] {
    const items: T[] = [];
    for (const raw of dados as unknown[]) {
      const resultado = normalize(raw);
      if (resultado.ok) items.push(resultado.value);
      else erros.push(resultado.reason);
    }
    return items;
  }

  let result: SofitSyncEntityResult;
  try {
    switch (entidade) {
      case "VEICULOS":
        result = await syncVehiclesIntoDb(companyId, coletar(normalizeVehicle));
        break;
      case "ABASTECIMENTOS":
        result = await syncFuelSuppliesIntoDb(companyId, coletar(normalizeFuelSupply));
        break;
      case "MANUTENCOES":
        result = await syncMaintenancesIntoDb(companyId, coletar(normalizeMaintenance));
        break;
      case "ODOMETRO":
        result = await syncOdometerIntoDb(companyId, coletar(normalizeOdometerReading));
        break;
    }
  } catch (e) {
    // Falha de gravacao tambem vira log (com sucesso: false) antes de
    // responder — um push que sumiu sem rastro e impossivel de diagnosticar
    // depois, e o emissor precisa do 5xx pra reenviar.
    const mensagem = e instanceof Error ? e.message : "Falha ao gravar os dados recebidos.";
    await registrarSyncLog(companyId, {
      entidade,
      origem: "WEBHOOK",
      periodoInicio: null,
      periodoFim: null,
      result: { entidade, lidos: dados.length, criados: 0, atualizados: 0, ignorados: 0, avisos: [], erros: [mensagem] },
      sucesso: false,
      duracaoMs: Date.now() - started,
      executadoPor: null,
    });
    return NextResponse.json({ error: mensagem }, { status: 500 });
  }

  // `lidos` conta o que CHEGOU (inclusive o que nao deu pra interpretar),
  // nao so o que passou pelo normalizador — senao um lote todo invalido
  // apareceria no historico como "0 lidos", parecendo que nada foi enviado.
  result.lidos = dados.length;
  result.erros.push(...erros);

  await registrarSyncLog(companyId, {
    entidade,
    origem: "WEBHOOK",
    periodoInicio: null,
    periodoFim: null,
    result,
    sucesso: true,
    duracaoMs: Date.now() - started,
    executadoPor: null,
  });

  return NextResponse.json({
    entidade,
    recebidos: dados.length,
    criados: result.criados,
    atualizados: result.atualizados,
    ignorados: result.ignorados,
    erros: result.erros,
    avisos: result.avisos,
  });
}
