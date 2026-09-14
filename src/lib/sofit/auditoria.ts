import { differenceInCalendarDays, format, subDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { currentKm } from "@/lib/maintenance";
import { OS_STATUS_ABERTOS } from "@/lib/sofit/manutencaoSync";
import { CATEGORIA_REVISAO, categoriaCausa, ehCorretiva, INTERVALO_DIAS_MINIMO_PLAUSIVEL, KM_POR_DIA_MAXIMO_PLAUSIVEL } from "@/lib/manutencao";

export const KM_PLAUSIVEL_MAX = 500_000;
export const KM_POR_ANO_MAX = 120_000;
export const KM_POR_ANO_MIN_ATIVO = 3_000;
export const DIVERGENCIA_ODOMETRO_PCT = 0.2;
export const DIVERGENCIA_ODOMETRO_MIN_KM = 5_000;

export type Gravidade = "alta" | "media" | "baixa";
export type AchadoLinha = Record<string, string | number | null>;
export type Achado = {
  chave: string;
  titulo: string;
  gravidade: Gravidade;
  oQueFazer: string;
  colunas: string[];
  linhas: AchadoLinha[];
};
export type AuditoriaSofit = {
  geradoEm: Date;
  achados: Achado[];
  totalLinhas: number;
  porGravidade: Record<Gravidade, number>;
};

const d = (x: Date | null | undefined) => (x ? format(x, "dd/MM/yyyy") : null);

// Auditoria de qualidade do dado da Sofit — pedido do usuario (2026-09-13):
// "o sistema deve ter muita informacao errada, vamos ter que auditar e
// corrigir". Cada achado e uma lista pronta pra entregar a equipe de
// manutencao corrigir LA (aqui nada e editado): hodometro absurdo,
// hodometro divergente da Ituran, OS com hodometro regressivo, OS
// esquecida aberta, preventiva travada, veiculo "em manutencao" sem OS,
// vencimento nunca baixado, cadastro fora de sincronia entre frota e Sofit.
// Tudo calculado do espelho local (OrdemServico/Vehicle/VencimentoVeiculo).
export async function auditarSofit(companyId: string, now = new Date()): Promise<AuditoriaSofit> {
  const [vehicles, os, vencimentos] = await Promise.all([
    prisma.vehicle.findMany({
      where: { companyId },
      select: {
        id: true,
        plate: true,
        brand: true,
        model: true,
        year: true,
        status: true,
        currentMileage: true,
        lastMaintenanceMileage: true,
        ultimaManutencaoEm: true,
        sofitId: true,
        sofitStatus: true,
        sofitDisponibilidade: true,
        sofitOdometroKm: true,
        sofitOdometroBrutoKm: true,
        manutencaoIntervaloKm: true,
        manutencaoIntervaloDias: true,
      },
      orderBy: { plate: "asc" },
    }),
    prisma.ordemServico.findMany({
      where: { companyId },
      select: {
        numero: true,
        vehicleId: true,
        placaOriginal: true,
        tipo: true,
        status: true,
        criadaEm: true,
        fimEm: true,
        diasParado: true,
        hodometroFinal: true,
        hodometroFinalBruto: true,
        fornecedor: true,
        problema: true,
      },
      orderBy: { criadaEm: "asc" },
    }),
    prisma.vencimentoVeiculo.findMany({ where: { companyId }, include: { vehicle: { select: { plate: true } } } }),
  ]);

  const plateById = new Map(vehicles.map((v) => [v.id, v.plate]));
  const plateOf = (o: { vehicleId: string | null; placaOriginal: string | null }) => (o.vehicleId && plateById.get(o.vehicleId)) || o.placaOriginal || "?";
  const problema1 = (p: string | null) => p?.split("\n")[0]?.trim().slice(0, 80) ?? null;
  const ativosSofit = vehicles.filter((v) => v.sofitId && v.sofitStatus === "active");
  const abertas = os.filter((o) => (OS_STATUS_ABERTOS as readonly string[]).includes(o.status ?? ""));
  const achados: Achado[] = [];

  // 1. Hodometro implausivel na Sofit
  achados.push({
    chave: "hodometro_implausivel",
    titulo: `Hodômetro implausível no cadastro da Sofit (> ${KM_PLAUSIVEL_MAX.toLocaleString("pt-BR")} km)`,
    gravidade: "alta",
    oQueFazer: "Corrigir o hodômetro do veículo na Sofit. Enquanto isso o sistema ignora esse valor e usa só o da Ituran.",
    colunas: ["Placa", "Modelo", "Ano", "Hodômetro na Sofit", "Hodômetro na Ituran"],
    linhas: vehicles
      .filter((v) => v.sofitOdometroBrutoKm != null && v.sofitOdometroBrutoKm > KM_PLAUSIVEL_MAX)
      .map((v) => ({ Placa: v.plate, Modelo: `${v.brand} ${v.model}`.trim(), Ano: v.year, "Hodômetro na Sofit": v.sofitOdometroBrutoKm, "Hodômetro na Ituran": v.currentMileage || null })),
  });

  // 2. Km por ano implausivel pela idade
  achados.push({
    chave: "km_por_ano",
    titulo: `Km por ano implausível pela idade do veículo (> ${KM_POR_ANO_MAX.toLocaleString("pt-BR")} km/ano)`,
    gravidade: "media",
    oQueFazer: "Ou o ano do veículo está errado, ou o hodômetro foi digitado errado (na Sofit ou no cadastro). Conferir o CRLV.",
    colunas: ["Placa", "Modelo", "Ano", "Km atual", "Km por ano"],
    linhas: vehicles
      .filter((v) => v.year && v.status !== "INATIVO")
      .map((v) => {
        const idade = Math.max(1, now.getFullYear() - v.year! + 1);
        const km = currentKm(v);
        return { v, km, kmAno: Math.round(km / idade) };
      })
      .filter((x) => x.kmAno > KM_POR_ANO_MAX)
      .map(({ v, km, kmAno }) => ({ Placa: v.plate, Modelo: `${v.brand} ${v.model}`.trim(), Ano: v.year, "Km atual": km, "Km por ano": kmAno })),
  });

  // 3. Hodometro Sofit x Ituran divergente
  achados.push({
    chave: "odometro_divergente",
    titulo: `Hodômetro da Sofit divergente da Ituran (> ${DIVERGENCIA_ODOMETRO_PCT * 100}% e > ${DIVERGENCIA_ODOMETRO_MIN_KM.toLocaleString("pt-BR")} km)`,
    gravidade: "media",
    oQueFazer: "A Ituran lê o hodômetro do veículo; se a Sofit está muito abaixo, ninguém atualiza o km lá e as revisões por km atrasam. Atualizar na Sofit (ou revisar o cadastro da Ituran se for ela que está errada).",
    colunas: ["Placa", "Hodômetro Sofit", "Hodômetro Ituran", "Diferença (km)", "Diferença (%)"],
    linhas: vehicles
      .filter((v) => v.sofitOdometroKm && v.currentMileage > 0)
      .map((v) => {
        const diff = Math.abs(v.sofitOdometroKm! - v.currentMileage);
        const pct = diff / Math.max(v.sofitOdometroKm!, v.currentMileage);
        return { v, diff, pct };
      })
      .filter((x) => x.pct > DIVERGENCIA_ODOMETRO_PCT && x.diff > DIVERGENCIA_ODOMETRO_MIN_KM)
      .sort((a, b) => b.diff - a.diff)
      .map(({ v, diff, pct }) => ({ Placa: v.plate, "Hodômetro Sofit": v.sofitOdometroKm, "Hodômetro Ituran": v.currentMileage, "Diferença (km)": diff, "Diferença (%)": Math.round(pct * 100) })),
  });

  // 4. OS com hodometro regressivo ou implausivel
  const regressivas: AchadoLinha[] = [];
  const maxPorVeiculo = new Map<string, { km: number; numero: string }>();
  for (const o of os) {
    if (!o.vehicleId || o.status !== "finished") continue;
    if (o.hodometroFinalBruto != null && o.hodometroFinalBruto > KM_PLAUSIVEL_MAX) {
      regressivas.push({ OS: o.numero, Placa: plateOf(o), Data: d(o.fimEm), "Hodômetro na OS": o.hodometroFinalBruto, "OS anterior": null, Problema: "hodômetro implausível" });
      continue;
    }
    if (!o.hodometroFinal) continue;
    const prev = maxPorVeiculo.get(o.vehicleId);
    if (prev && o.hodometroFinal < prev.km - 100) {
      regressivas.push({ OS: o.numero, Placa: plateOf(o), Data: d(o.fimEm), "Hodômetro na OS": o.hodometroFinal, "OS anterior": `${prev.numero} (${prev.km.toLocaleString("pt-BR")} km)`, Problema: problema1(o.problema) });
    }
    if (!prev || o.hodometroFinal > prev.km) maxPorVeiculo.set(o.vehicleId, { km: o.hodometroFinal, numero: o.numero });
  }
  achados.push({
    chave: "os_hodometro",
    titulo: "OS concluída com hodômetro menor que a OS anterior do mesmo veículo (ou implausível)",
    gravidade: "media",
    oQueFazer: "Hodômetro digitado errado no fechamento da OS. Corrigir na Sofit — a 'última revisão' e o km desde a revisão dependem disso.",
    colunas: ["OS", "Placa", "Data", "Hodômetro na OS", "OS anterior", "Problema"],
    linhas: regressivas.slice(-300).reverse(),
  });

  // 4b. Hodometro da ultima revisao incoerente com o km atual
  achados.push({
    chave: "revisao_km_incoerente",
    titulo: `Km rodado desde a última revisão implausível (> ${KM_POR_DIA_MAXIMO_PLAUSIVEL} km/dia)`,
    gravidade: "media",
    oQueFazer: "Ou o hodômetro digitado no fechamento da OS de revisão está errado (dígito a menos), ou o km atual está. Corrigir na Sofit — enquanto isso o veículo é avaliado só pelo critério de dias.",
    colunas: ["Placa", "Última revisão", "Hodômetro na revisão", "Km atual", "Dias desde", "Km por dia"],
    linhas: vehicles
      .filter((v) => v.lastMaintenanceMileage > 0 && v.ultimaManutencaoEm && currentKm(v) > v.lastMaintenanceMileage)
      .map((v) => {
        const dias = Math.max(1, differenceInCalendarDays(now, v.ultimaManutencaoEm!));
        const kmDia = Math.round((currentKm(v) - v.lastMaintenanceMileage) / dias);
        return { v, dias, kmDia };
      })
      .filter((x) => x.kmDia > KM_POR_DIA_MAXIMO_PLAUSIVEL)
      .sort((a, b) => b.kmDia - a.kmDia)
      .map(({ v, dias, kmDia }) => ({ Placa: v.plate, "Última revisão": d(v.ultimaManutencaoEm), "Hodômetro na revisão": v.lastMaintenanceMileage, "Km atual": currentKm(v), "Dias desde": dias, "Km por dia": kmDia })),
  });

  // 5. OS em andamento antigas
  achados.push({
    chave: "os_antiga",
    titulo: 'OS "em andamento" há mais de 30 dias',
    gravidade: "alta",
    oQueFazer: "Fechar na Sofit as que já foram feitas (com hodômetro e data reais) e cancelar as que não vão acontecer. OS aberta mantém o veículo 'em manutenção' e polui todos os indicadores.",
    colunas: ["OS", "Placa", "Tipo", "Aberta em", "Dias", "Fornecedor", "Problema"],
    linhas: abertas
      .filter((o) => o.status === "inProgress" && differenceInCalendarDays(now, o.criadaEm) > 30)
      .map((o) => ({ OS: o.numero, Placa: plateOf(o), Tipo: o.tipo, "Aberta em": d(o.criadaEm), Dias: differenceInCalendarDays(now, o.criadaEm), Fornecedor: o.fornecedor, Problema: problema1(o.problema) })),
  });

  // 6. Preventivas aguardando aprovacao
  achados.push({
    chave: "preventiva_aprovacao",
    titulo: "Preventivas geradas pelo plano aguardando aprovação há mais de 7 dias",
    gravidade: "alta",
    oQueFazer: "Aprovar (e executar) ou recusar com motivo na Sofit. Enquanto ficam aguardando, o plano preventivo não anda e a frota só recebe corretiva.",
    colunas: ["OS", "Placa", "Aberta em", "Dias", "Problema"],
    linhas: abertas
      .filter((o) => o.status === "underApproval" && differenceInCalendarDays(now, o.criadaEm) > 7)
      .map((o) => ({ OS: o.numero, Placa: plateOf(o), "Aberta em": d(o.criadaEm), Dias: differenceInCalendarDays(now, o.criadaEm), Problema: problema1(o.problema) })),
  });

  // 7. Parado sem OS / OS aberta com veiculo disponivel
  const comOsAberta = new Set(abertas.map((o) => o.vehicleId).filter(Boolean));
  achados.push({
    chave: "parado_sem_os",
    titulo: 'Veículo "em manutenção" na Sofit sem nenhuma OS aberta',
    gravidade: "alta",
    oQueFazer: "Se o veículo já voltou, liberar na Sofit; se está parado mesmo, abrir a OS. Sem isso não dá para saber por que a frota está indisponível.",
    colunas: ["Placa", "Modelo", "Ano", "Hodômetro"],
    linhas: ativosSofit
      .filter((v) => v.sofitDisponibilidade === "inMaintenance" && !comOsAberta.has(v.id))
      .map((v) => ({ Placa: v.plate, Modelo: `${v.brand} ${v.model}`.trim(), Ano: v.year, Hodômetro: currentKm(v) || null })),
  });
  achados.push({
    chave: "os_aberta_disponivel",
    titulo: 'OS aberta em veículo marcado "disponível" ou "em uso" na Sofit',
    gravidade: "baixa",
    oQueFazer: "Ou a OS já foi concluída e não foi fechada, ou o veículo está rodando com serviço pendente. Conferir e fechar/ajustar.",
    colunas: ["OS", "Placa", "Tipo", "Status", "Aberta em", "Dias", "Problema"],
    linhas: abertas
      .filter((o) => {
        const v = o.vehicleId ? vehicles.find((x) => x.id === o.vehicleId) : undefined;
        return v && (v.sofitDisponibilidade === "available" || v.sofitDisponibilidade === "inUse") && o.status === "inProgress";
      })
      .map((o) => ({ OS: o.numero, Placa: plateOf(o), Tipo: o.tipo, Status: o.status, "Aberta em": d(o.criadaEm), Dias: differenceInCalendarDays(now, o.criadaEm), Problema: problema1(o.problema) })),
  });

  // 8. OS de veiculo fora da frota / sem fornecedor / sem hodometro
  achados.push({
    chave: "os_sem_veiculo",
    titulo: "OS aberta cujo veículo não bate com a frota cadastrada",
    gravidade: "media",
    oQueFazer: "Placa digitada diferente na Sofit ou veículo já vendido/baixado. Corrigir a placa na Sofit ou inativar o veículo lá.",
    colunas: ["OS", "Placa na Sofit", "Tipo", "Status", "Aberta em", "Problema"],
    linhas: abertas.filter((o) => !o.vehicleId).map((o) => ({ OS: o.numero, "Placa na Sofit": o.placaOriginal, Tipo: o.tipo, Status: o.status, "Aberta em": d(o.criadaEm), Problema: problema1(o.problema) })),
  });
  const inicio90 = subDays(now, 90);
  achados.push({
    chave: "os_sem_hodometro",
    titulo: "OS concluída nos últimos 90 dias sem hodômetro no fechamento",
    gravidade: "baixa",
    oQueFazer: "Exigir o hodômetro no fechamento — é o que alimenta a 'última revisão' e o cálculo de km desde a revisão.",
    colunas: ["OS", "Placa", "Tipo", "Concluída em", "Fornecedor", "Problema"],
    linhas: os
      .filter((o) => o.status === "finished" && o.fimEm && o.fimEm >= inicio90 && !o.hodometroFinalBruto)
      .map((o) => ({ OS: o.numero, Placa: plateOf(o), Tipo: o.tipo, "Concluída em": d(o.fimEm), Fornecedor: o.fornecedor, Problema: problema1(o.problema) })),
  });
  achados.push({
    chave: "os_dias_parado",
    titulo: "OS concluída com mais de 60 dias parado (suspeito de fechamento atrasado)",
    gravidade: "baixa",
    oQueFazer: "Se o veículo não ficou esse tempo todo parado, a OS foi fechada muito depois do serviço — a data de conclusão precisa ser a real.",
    colunas: ["OS", "Placa", "Tipo", "Aberta em", "Concluída em", "Dias parado", "Problema"],
    linhas: os
      .filter((o) => o.status === "finished" && o.fimEm && o.fimEm >= subDays(now, 180) && (o.diasParado ?? 0) > 60)
      .map((o) => ({ OS: o.numero, Placa: plateOf(o), Tipo: o.tipo, "Aberta em": d(o.criadaEm), "Concluída em": d(o.fimEm), "Dias parado": Math.round(o.diasParado ?? 0), Problema: problema1(o.problema) })),
  });

  // 8b. Revisao/inspecao aberta como corretiva
  achados.push({
    chave: "revisao_como_corretiva",
    titulo: 'Revisão/inspeção aberta como "corretiva" (últimos 90 dias)',
    gravidade: "media",
    oQueFazer: "Abrir revisões e inspeções (escolar, EMTU, periódica) como PREVENTIVA na Sofit. Como corretiva, elas inflam a taxa de corretiva e escondem a preventiva que de fato acontece.",
    colunas: ["OS", "Placa", "Tipo na Sofit", "Aberta em", "Status", "Descrição"],
    linhas: os
      .filter((o) => o.criadaEm >= inicio90 && ehCorretiva(o.tipo) && categoriaCausa(o.problema) === CATEGORIA_REVISAO)
      .map((o) => ({ OS: o.numero, Placa: plateOf(o), "Tipo na Sofit": o.tipo, "Aberta em": d(o.criadaEm), Status: o.status, Descrição: problema1(o.problema) })),
  });

  // 9. Vencimentos nao baixados
  const umAno = subDays(now, 365);
  achados.push({
    chave: "vencimento_antigo",
    titulo: "Vencimento sem recorrência vencido há mais de 1 ano e nunca baixado",
    gravidade: "media",
    oQueFazer: "Registrar a renovação na Sofit (ou marcar como recorrente com a nova data). Vencimento antigo esconde o que vence de verdade.",
    colunas: ["Placa", "Vencimento", "Data", "Dias vencido"],
    linhas: vencimentos
      .filter((v) => !v.recorrente && v.venceEm < umAno)
      .sort((a, b) => a.venceEm.getTime() - b.venceEm.getTime())
      .map((v) => ({ Placa: v.vehicle.plate, Vencimento: v.tipo, Data: d(v.venceEm), "Dias vencido": differenceInCalendarDays(now, v.venceEm) })),
  });

  // 10. Cadastro fora de sincronia entre frota e Sofit
  achados.push({
    chave: "sem_intervalo",
    titulo: "Veículo ativo na Sofit sem intervalo de manutenção cadastrado",
    gravidade: "baixa",
    oQueFazer: "Cadastrar a frequência (km e/ou dias) no veículo na Sofit — sem isso o plano preventivo nunca gera OS para ele e aqui ele não entra na aderência ao plano.",
    colunas: ["Placa", "Modelo", "Ano", "Hodômetro"],
    linhas: ativosSofit.filter((v) => !v.manutencaoIntervaloKm && !v.manutencaoIntervaloDias).map((v) => ({ Placa: v.plate, Modelo: `${v.brand} ${v.model}`.trim(), Ano: v.year, Hodômetro: currentKm(v) || null })),
  });
  achados.push({
    chave: "intervalo_dias_implausivel",
    titulo: `Intervalo de manutenção em dias implausível na Sofit (menor que ${INTERVALO_DIAS_MINIMO_PLAUSIVEL} dias)`,
    gravidade: "media",
    oQueFazer: "Revisar a frequência em dias do veículo na Sofit (visto '10 dias' em dezenas de veículos). Com isso o plano gera OS preventiva a cada 10 dias que ninguém aprova — é uma das causas das 70+ preventivas travadas. Aqui esse intervalo é ignorado; vale só o de km.",
    colunas: ["Placa", "Modelo", "Intervalo (dias)", "Intervalo (km)"],
    linhas: ativosSofit
      .filter((v) => v.manutencaoIntervaloDias && v.manutencaoIntervaloDias < INTERVALO_DIAS_MINIMO_PLAUSIVEL)
      .map((v) => ({ Placa: v.plate, Modelo: `${v.brand} ${v.model}`.trim(), "Intervalo (dias)": v.manutencaoIntervaloDias, "Intervalo (km)": v.manutencaoIntervaloKm })),
  });
  achados.push({
    chave: "frota_sem_sofit",
    titulo: "Veículo ativo na frota (Ituran/SIAT) sem cadastro na Sofit",
    gravidade: "media",
    oQueFazer: "Cadastrar na Sofit — veículo fora dela não tem OS, plano nem vencimento controlados.",
    colunas: ["Placa", "Modelo", "Ano", "Hodômetro Ituran"],
    linhas: vehicles.filter((v) => !v.sofitId && v.status !== "INATIVO").map((v) => ({ Placa: v.plate, Modelo: `${v.brand} ${v.model}`.trim(), Ano: v.year, "Hodômetro Ituran": v.currentMileage || null })),
  });
  achados.push({
    chave: "status_divergente",
    titulo: "Status do veículo diferente entre a frota e a Sofit (ativo × inativo)",
    gravidade: "baixa",
    oQueFazer: "Alinhar: veículo vendido/baixado deve estar inativo nos dois; veículo operando deve estar ativo nos dois.",
    colunas: ["Placa", "Modelo", "Status na frota", "Status na Sofit"],
    linhas: vehicles
      .filter((v) => v.sofitId && ((v.status === "INATIVO" && v.sofitStatus === "active") || (v.status !== "INATIVO" && v.sofitStatus && v.sofitStatus !== "active")))
      .map((v) => ({ Placa: v.plate, Modelo: `${v.brand} ${v.model}`.trim(), "Status na frota": v.status, "Status na Sofit": v.sofitStatus })),
  });
  achados.push({
    chave: "km_baixo_idade",
    titulo: `Veículo ativo rodando menos de ${KM_POR_ANO_MIN_ATIVO.toLocaleString("pt-BR")} km/ano pela idade (hodômetro parado?)`,
    gravidade: "baixa",
    oQueFazer: "Hodômetro não atualizado em nenhuma fonte, veículo reserva, ou ano de fabricação errado. Conferir.",
    colunas: ["Placa", "Modelo", "Ano", "Km atual", "Km por ano"],
    linhas: vehicles
      .filter((v) => v.year && v.status !== "INATIVO" && currentKm(v) > 0)
      .map((v) => {
        const idade = Math.max(1, now.getFullYear() - v.year! + 1);
        const km = currentKm(v);
        return { v, km, kmAno: Math.round(km / idade) };
      })
      .filter((x) => x.kmAno < KM_POR_ANO_MIN_ATIVO)
      .map(({ v, km, kmAno }) => ({ Placa: v.plate, Modelo: `${v.brand} ${v.model}`.trim(), Ano: v.year, "Km atual": km, "Km por ano": kmAno })),
  });

  const ordem: Record<Gravidade, number> = { alta: 0, media: 1, baixa: 2 };
  const comLinhas = achados.filter((a) => a.linhas.length > 0).sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade] || b.linhas.length - a.linhas.length);
  const porGravidade: Record<Gravidade, number> = { alta: 0, media: 0, baixa: 0 };
  for (const a of comLinhas) porGravidade[a.gravidade] += a.linhas.length;
  return { geradoEm: now, achados: comLinhas, totalLinhas: comLinhas.reduce((s, a) => s + a.linhas.length, 0), porGravidade };
}
