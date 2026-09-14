// Rotulo humano de cada ferramenta do assistente — usado no chip "Consultou:"
// do chat. Modulo sem dependencia de prisma/servidor pra poder ser importado
// tanto pelo Client Component quanto pelo lado servidor.
export const FERRAMENTA_LABEL: Record<string, string> = {
  buscar_motoristas: "motoristas",
  buscar_veiculos: "veículos",
  quem_estava_com_veiculo: "quem estava com o veículo",
  escalas: "escalas (SIAT)",
  viagens_ituran: "viagens (Ituran)",
  ponto: "ponto",
  multas: "multas",
  abastecimentos: "abastecimentos",
  afastamentos: "afastamentos",
  custos_do_mes: "custos do mês",
  risco_motoristas: "risco por motorista",
  pendencias_hoje: "painel Hoje",
  manutencao_resumo: "manutenção (Sofit)",
  os_abertas: "OS abertas",
  veiculos_parados: "veículos parados",
  aderencia_plano: "aderência ao plano",
  historico_manutencao_veiculo: "histórico de manutenção",
  auditoria_sofit: "auditoria da Sofit",
};
