// Tipos NORMALIZADOS da integracao com o Sofit (sistema de gestao de frota
// usado pela empresa — veiculos, abastecimentos, manutencoes e odometro).
//
// Sao deliberadamente NOSSOS tipos, nao o espelho do JSON do Sofit: a API do
// Sofit nao tem documentacao publica (o proprio site so diz "importacao via
// API/webservice, com mapeamento de campos" e manda falar com o comercial),
// entao o contrato exato de campos so e conhecido cliente a cliente. Toda a
// tolerancia a nomes de campo diferentes fica concentrada em
// src/lib/sofit/normalize.ts; do resto do sistema pra ca, so estes tipos
// aparecem. Quando o contrato real chegar, muda-se normalize.ts (e, se
// preciso, os caminhos em config.ts) — nada mais.

export type SofitVehicleStatus = "ATIVO" | "MANUTENCAO" | "INATIVO";

export type SofitVehicle = {
  // Id do veiculo no Sofit, quando vem. Nao e a chave de casamento com o
  // nosso cadastro (usamos a placa, que e unica em Vehicle e e como a frota
  // real e identificada em todos os relatorios) — serve so pra auditoria e
  // pra montar mensagens de erro rastreaveis.
  externalId: string | null;
  plate: string; // sempre normalizada: maiuscula, sem espaco/hifen
  brand: string | null;
  model: string | null;
  year: number | null;
  type: string | null;
  status: SofitVehicleStatus | null;
  // Hodometro atual (km) conforme o Sofit. Nulo quando o campo nao veio.
  odometer: number | null;
};

export type SofitFuelSupply = {
  externalId: string | null;
  plate: string;
  dataHora: Date;
  valorCents: number;
  volumeLitros: number;
  combustivel: string | null;
  posto: string | null;
  cidade: string | null;
  uf: string | null;
  hodometro: number | null;
  motoristaNome: string | null;
  motoristaCpf: string | null; // so digitos
};

export type SofitMaintenance = {
  externalId: string | null;
  plate: string;
  data: Date | null;
  // Hodometro no momento da manutencao. E o dado que interessa ao nosso
  // alerta de manutencao preventiva (Vehicle.lastMaintenanceMileage, ver
  // src/lib/maintenance.ts) — sem ele a manutencao nao move nada aqui.
  hodometro: number | null;
  tipo: string | null;
  descricao: string | null;
  // Manutencao ainda em aberto no Sofit (veiculo parado na oficina) nao
  // reseta o contador preventivo — so a concluida.
  concluida: boolean;
  valorCents: number | null;
};

export type SofitOdometerReading = {
  plate: string;
  hodometro: number;
  data: Date | null;
};

export type SofitDriver = {
  externalId: string | null;
  nome: string;
  cpf: string | null; // so digitos
  cnh: string | null;
  categoriaCnh: string | null;
  validadeCnh: Date | null;
};

// Entidades sincronizaveis. O valor de texto e o que vai pro banco
// (SofitSyncLog.entidade) e pros parametros de rota/cron — mantenha estavel.
export const SOFIT_ENTITIES = ["VEICULOS", "ABASTECIMENTOS", "MANUTENCOES", "ODOMETRO"] as const;
export type SofitEntity = (typeof SOFIT_ENTITIES)[number];

export const SOFIT_ENTITY_LABELS: Record<SofitEntity, string> = {
  VEICULOS: "Veículos",
  ABASTECIMENTOS: "Abastecimentos",
  MANUTENCOES: "Manutenções",
  ODOMETRO: "Odômetro",
};

// Resultado de uma entidade sincronizada. `avisos` sao ocorrencias que NAO
// impediram a importacao (ex.: veiculo criado sem ano porque o Sofit nao
// mandou o campo) — separadas de `erros`, que sao itens descartados.
export type SofitSyncEntityResult = {
  entidade: SofitEntity;
  lidos: number;
  criados: number;
  atualizados: number;
  ignorados: number;
  avisos: string[];
  erros: string[];
};
