"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isLwAvailable, getLwToken, buscarCondutorPorCpfEMulta, indicarCondutorLw, statusIndicacao } from "@/lib/lw/client";
import { prepareMultasSyncPlan, syncMultasForVehicle, type MultasSyncPlan } from "@/lib/lw/sync";
import { resolveCondutorParaMulta } from "@/lib/lw/resolveCondutor";

export { isLwAvailable };

export async function prepareMultasSync(): Promise<MultasSyncPlan> {
  const session = await requireRole("ADMIN", "GESTOR");
  return prepareMultasSyncPlan(session.companyId);
}

export type SyncMultasVehicleState =
  | { error: string }
  | { criadas: number; atualizadas: number; totalMultas: number };

// 1 veiculo por chamada, ver comentario em src/lib/lw/sync.ts sobre por que
// (evitar timeout de funcao serverless na frota inteira, mesmo padrao ja
// usado pro TiqueTaque/Ituran). Depois de sincronizar as multas do veiculo,
// tenta resolver o condutor automaticamente pra cada multa nova/ainda
// pendente — nunca envia nada pra LW sozinho, so sugere.
export async function syncMultasVehicle(vehicleId: string, placaParaConsulta: string): Promise<SyncMultasVehicleState> {
  const session = await requireRole("ADMIN", "GESTOR");
  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId, companyId: session.companyId } });
    if (!vehicle) return { error: "Veículo não encontrado." };

    const result = await syncMultasForVehicle(session.companyId, vehicleId, placaParaConsulta);

    const multas = await prisma.multa.findMany({
      where: { vehicleId, companyId: session.companyId },
      include: { indicacao: true },
    });
    for (const multa of multas) {
      // Toda multa ganha uma linha de IndicacaoCondutor (mesmo sem sugestao
      // automatica, status fica PENDENTE_MANUAL) — sem isso, filtrar/ordenar
      // por status de indicacao na listagem teria que tratar "sem linha" e
      // "PENDENTE_MANUAL" como o mesmo caso em dois lugares diferentes.
      const podeAutoResolver =
        !multa.indicacao || (multa.indicacao.origemResolucao !== "MANUAL" && multa.indicacao.status === "PENDENTE_MANUAL");
      if (!podeAutoResolver) continue;

      const resolved = await resolveCondutorParaMulta({
        vehicleId: multa.vehicleId,
        dataInfracao: multa.dataInfracao,
        horaInfracao: multa.horaInfracao,
      });

      if (resolved.driverId) {
        await prisma.indicacaoCondutor.upsert({
          where: { multaId: multa.id },
          create: {
            companyId: session.companyId,
            multaId: multa.id,
            driverId: resolved.driverId,
            status: "SUGERIDA",
            origemResolucao: resolved.origem,
          },
          update: { driverId: resolved.driverId, status: "SUGERIDA", origemResolucao: resolved.origem },
        });
      } else if (!multa.indicacao) {
        await prisma.indicacaoCondutor.create({
          data: { companyId: session.companyId, multaId: multa.id, status: "PENDENTE_MANUAL" },
        });
      }
    }

    revalidatePath("/multas");
    return result;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao sincronizar multas." };
  }
}

export type SetCondutorManualState = { error?: string; ok?: boolean };

export async function definirCondutorManual(multaId: string, driverId: string): Promise<SetCondutorManualState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const multa = await prisma.multa.findUnique({ where: { id: multaId, companyId: session.companyId } });
  if (!multa) return { error: "Multa não encontrada." };
  const driver = await prisma.driver.findUnique({ where: { id: driverId, companyId: session.companyId } });
  if (!driver) return { error: "Motorista não encontrado." };

  await prisma.indicacaoCondutor.upsert({
    where: { multaId },
    create: { companyId: session.companyId, multaId, driverId, status: "SUGERIDA", origemResolucao: "MANUAL" },
    update: { driverId, status: "SUGERIDA", origemResolucao: "MANUAL" },
  });
  revalidatePath("/multas");
  return { ok: true };
}

export type EnviarIndicacaoState = { error?: string; ok?: boolean };

// Confirma pra LW quem e o condutor responsavel pela multa — tem efeito
// juridico real (fica em nome de uma pessoa de verdade perante o orgao de
// transito), por isso so roda com clique explicito por multa, nunca em
// lote/automatico. Pressupoe que o condutor ja esta cadastrado do lado da
// LW (ver comentario em src/lib/lw/client.ts:indicarCondutorLw) — se nao
// estiver, devolve um erro claro em vez de tentar cadastrar com dados que
// este sistema nao coleta hoje (endereco, data de nascimento).
export async function enviarIndicacaoCondutor(multaId: string): Promise<EnviarIndicacaoState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const multa = await prisma.multa.findUnique({
    where: { id: multaId, companyId: session.companyId },
    include: { indicacao: { include: { driver: true } } },
  });
  if (!multa) return { error: "Multa não encontrada." };
  const driver = multa.indicacao?.driver;
  if (!driver) return { error: "Selecione um motorista para esta multa antes de enviar." };
  if (!driver.cnh) return { error: `${driver.name} não tem número de CNH cadastrado — complete o cadastro antes de indicar.` };

  try {
    const token = await getLwToken();
    const condutorExistente = await buscarCondutorPorCpfEMulta(token, driver.cpf.replace(/\D/g, ""), driver.cnh);
    if (!condutorExistente) {
      return {
        error: `${driver.name} ainda não está cadastrado como condutor na LW (CPF/CNH não localizados lá). Cadastre-o diretamente no painel da LW antes de indicar por aqui.`,
      };
    }

    await indicarCondutorLw(token, {
      cpfCondutor: driver.cpf.replace(/\D/g, ""),
      idMulta: Number(multa.lwId),
      numeroRegistro: driver.cnh,
    });

    await prisma.indicacaoCondutor.update({
      where: { multaId },
      data: { status: "ENVIADA", enviadaEm: new Date() },
    });
    revalidatePath("/multas");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao enviar indicação para a LW." };
  }
}

export type VerificarStatusState = { error?: string; descricao?: string };

// So consulta e guarda a descricao textual que a LW devolve (ver
// observacao) — nao muda o status ENVIADA sozinho pra VALIDADA/REJEITADA,
// porque o significado exato dos valores desse endpoint nao foi confirmado
// contra um caso real ainda (nenhuma indicacao foi validada de verdade
// nesta integracao ate agora). Fica a cargo de quem le a descricao marcar
// manualmente (ver marcarIndicacaoResultado abaixo) — mais seguro que
// adivinhar o mapeamento e classificar errado sozinho.
export async function verificarStatusIndicacao(multaId: string): Promise<VerificarStatusState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const multa = await prisma.multa.findUnique({ where: { id: multaId, companyId: session.companyId } });
  if (!multa) return { error: "Multa não encontrada." };

  try {
    const token = await getLwToken();
    const resultado = await statusIndicacao(token, multa.lwId);
    const descricao = resultado
      ? `${resultado.status_descricao}${resultado.mensagens_erro?.length ? ` — ${JSON.stringify(resultado.mensagens_erro)}` : ""}`
      : "LW não retornou informação de status para esta indicação ainda.";

    await prisma.indicacaoCondutor.update({ where: { multaId }, data: { observacao: descricao } });
    revalidatePath("/multas");
    return { descricao };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao consultar status na LW." };
  }
}

export type MarcarResultadoState = { error?: string; ok?: boolean };

// Confirmacao manual de leitura humana da descricao trazida por
// verificarStatusIndicacao (ver comentario acima sobre por que nao e
// automatico).
export async function marcarIndicacaoResultado(multaId: string, resultado: "VALIDADA" | "REJEITADA"): Promise<MarcarResultadoState> {
  const session = await requireRole("ADMIN", "GESTOR");
  const indicacao = await prisma.indicacaoCondutor.findFirst({ where: { multaId, companyId: session.companyId } });
  if (!indicacao) return { error: "Indicação não encontrada." };

  await prisma.indicacaoCondutor.update({
    where: { multaId },
    data: { status: resultado, validadaEm: resultado === "VALIDADA" ? new Date() : indicacao.validadaEm },
  });
  revalidatePath("/multas");
  return { ok: true };
}
