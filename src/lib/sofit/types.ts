// Formato cru da API GraphQL da Sofit (SofitView) — sem documentacao
// publica, descoberto via introspecao ao vivo (2026-08-31). Confirmado
// real: item.type "fuel" cobre tanto combustivel liquido (Diesel S10/S50/
// S500 etc.) quanto eletrico (Eletricidade/Energia Eletrica).
export type SofitItemRaw = {
  name: string;
  type: string;
};

export type SofitVehicleRaw = {
  license_plate: string | null;
};

export type SofitEmployeeRaw = {
  name: string | null;
  cpf: string | null;
};

export type SofitSupplierRaw = {
  name: string | null;
};

export type SofitTransactionRaw = {
  id: number;
  date: string | null;
  quantity: number | null;
  unit_value: number | null;
  total_value: number | null;
  odometer: number | null;
  real_consumption: number | null;
  deviation_percentage: number | null;
  distance: number | null;
  doc_number: string | null;
  item: SofitItemRaw | null;
  vehicle: SofitVehicleRaw | null;
  employee: SofitEmployeeRaw | null;
  supplier: SofitSupplierRaw | null;
};

export type SofitExpenseRaw = {
  id: number;
  date: string | null;
  expense_items: SofitTransactionRaw[];
};

export type SofitExpensesResponse = {
  expenses: { count: number; nodes: SofitExpenseRaw[] };
};

// Cadastro de funcionario da Sofit (query `employees`, separada de
// `expenses` acima) — confirmado real via introspecao (2026-09-05) que tem
// os campos de CNH que a folha/RH mantem la: habilitation_num/_category/
// _due_date (due_date ja vem "AAAA-MM-DD", sem hora). Nem todo funcionario
// tem isso preenchido (rodou nos 623 cadastrados: 324 com due_date).
export type SofitEmployeeCnhRaw = {
  id: number;
  cpf: string | null;
  habilitation_num: string | null;
  habilitation_category: string | null;
  habilitation_due_date: string | null;
};

export type SofitEmployeesResponse = {
  employees: { count: number; nodes: SofitEmployeeCnhRaw[] };
};

export type SofitEmployeeCnh = {
  cpf: string; // normalizado, so digitos
  habilitationNum: string | null;
  habilitationCategory: string | null;
  habilitationDueDate: string | null; // "AAAA-MM-DD"
};

// Ordem de servico (query serviceOrders) — campos confirmados por introspecao
// e amostra real (2026-09-13). Enums da Sofit chegam como string:
// type = preventive|corrective|improvement|breakdown|accident|tire|factory_warranty
// status = underApproval|planned|inProgress|waitingNf|finished|canceled
export type SofitServiceOrderRaw = {
  id: number;
  name: string | null;
  created_at: string | null;
  updated_at: string | null;
  type: string | null;
  status: string | null;
  origin: string | null;
  request_reason: string | null;
  problem_description: string | null;
  total_cost: number | null;
  service_start_date: string | null;
  service_finish_date: string | null;
  forecast_finish_date: string | null;
  vehicle_down_days: number | null;
  final_odometer: number | null;
  vehicle: SofitVehicleRaw | null;
  supplier: SofitSupplierRaw | null;
};

export type SofitServiceOrdersResponse = {
  serviceOrders: { count: number; nodes: SofitServiceOrderRaw[] };
};

export type SofitServiceOrder = {
  sofitId: string;
  numero: string;
  plate: string | null;
  tipo: string | null;
  status: string | null;
  origem: string | null;
  motivo: string | null;
  problema: string | null;
  fornecedor: string | null;
  criadaEm: Date;
  atualizadaEm: Date;
  inicioEm: Date | null;
  fimEm: Date | null;
  previsaoFimEm: Date | null;
  diasParado: number | null;
  hodometroFinal: number | null;
  custoCents: number | null;
};

// Veiculo na Sofit (query vehicles) com o que interessa pra manutencao:
// disponibilidade ao vivo, intervalo basico de manutencao e vencimentos
// (dues). `basic_maintenance_frequency_time_period` visto real: "days".
export type SofitVehicleDueRaw = {
  id: number;
  item_id: number | null;
  due_date: string | null;
  recurrent_due: boolean | null;
  recurrence: string | null;
};

export type SofitVehicleFullRaw = {
  id: number;
  license_plate: string | null;
  status: string | null;
  disponibility: string | null;
  current_odometer: number | null;
  basic_maintenance_frequency_km: number | null;
  basic_maintenance_frequency_time_num: number | null;
  basic_maintenance_frequency_time_period: string | null;
  dues: SofitVehicleDueRaw[] | null;
};

export type SofitVehiclesFullResponse = {
  vehicles: { count: number; nodes: SofitVehicleFullRaw[] };
};

export type SofitVehicleDue = {
  sofitDueId: string;
  itemId: string | null;
  venceEm: Date;
  recorrente: boolean;
  recorrencia: string | null;
};

export type SofitVehicle = {
  sofitId: string;
  plate: string | null;
  status: string | null;
  disponibilidade: string | null;
  odometroKm: number | null;
  intervaloKm: number | null;
  intervaloDias: number | null;
  dues: SofitVehicleDue[];
};

// Ja normalizado — o que o resto do codigo consome.
export type SofitFuelTransaction = {
  sofitTransactionId: string;
  dataHora: Date;
  valorCents: number | null;
  volumeLitros: number | null;
  combustivel: string | null;
  posto: string | null;
  hodometro: number | null;
  kmRodados: number | null;
  realConsumoKmL: number | null;
  desvioConsumoPercentual: number | null;
  numeroAutorizacao: string | null;
  plate: string | null;
  driverName: string | null;
  driverCpf: string | null;
};
