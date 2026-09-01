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
