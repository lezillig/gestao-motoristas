// Formato cru de cada entidade, exatamente como a API do SIAT devolve
// (snake_case) — ver documentacao tecnica fornecida pela Vinitech DEV
// (2026-08-19). Os tipos internos (sem sufixo "Raw") sao a forma ja
// normalizada que o resto do codigo consome.

export type SiatVehicleRaw = {
  id: string;
  company_id: string;
  plate: string;
  prefix?: string | null;
  type?: string | null;
  vehicle_ownership?: string | null;
  model?: string | null;
  brand?: string | null;
  year?: number | null;
  color?: string | null;
  capacity?: number | null;
  licensing_month?: string | null;
};

export type SiatVehicle = {
  id: string;
  plate: string;
  type: string | null;
  ownership: string | null;
  model: string | null;
  brand: string | null;
  year: number | null;
  color: string | null;
  capacity: number | null;
  licensingMonth: string | null;
};

export type SiatDriverRaw = {
  id: string;
  company_id: string;
  name: string;
  // Presente em alguns registros, vazio ("") em outros — confirmado real
  // (2026-08-20). Quando presente, permite casar/criar com mais confianca
  // que so por nome; quando ausente, so enriquece motorista ja cadastrado.
  cpf?: string | null;
  phone?: string | null;
  type?: string | null;
  cnh_number?: string | null;
  cnh_category?: string | null;
  cnh_validity?: string | null;
  is_active?: boolean | null;
  enabled_vehicles?: string[] | null;
};

export type SiatDriver = {
  id: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  type: string | null;
  cnhNumber: string | null;
  cnhCategory: string | null;
  cnhValidity: string | null; // YYYY-MM-DD
  isActive: boolean;
};

// ScaleAssignment existe na API mas, checado com dados reais (2026-08-20),
// nao serve como fonte de escala por dia: `date` vem nulo em 100% dos 85
// registros da AzulMob, e driver_id/vehicle_id em quase nenhum — parece ser
// um vinculo padrao motorista×rota ("Plantao"), nao uma instancia diaria.
// A escala do dia a dia de verdade mora em Reservation (date/time em 100%
// dos registros, volume real de 1000+) — usado abaixo no lugar dele.
export type SiatReservationRaw = {
  id: string;
  company_id: string;
  reservation_number?: string | null;
  date: string; // YYYY-MM-DD, sempre presente
  time: string; // HH:MM, sempre presente
  client_id?: string | null;
  client_name?: string | null;
  route_name?: string | null;
  status?: string | null;
  trip_type?: string | null;
  assigned_driver_id?: string | null;
  driver_name?: string | null;
  assigned_vehicle_id?: string | null;
  vehicle_info?: string | null;
  trip_end_time?: string | null; // HH:MM — sempre presente junto com trip_duration_minutes, e consistente com ele (confirmado real); preferido por nao precisar de aritmetica/fuso.
  boarding_address?: string | null;
  azul_pickup_address?: string | null;
  dropoff_address?: string | null;
  azul_dropoff_address?: string | null;
};

export type SiatReservation = {
  id: string;
  reservationNumber: string | null;
  date: string;
  time: string;
  clientName: string | null;
  routeName: string | null;
  status: string | null;
  driverId: string | null;
  driverName: string | null;
  vehicleId: string | null;
  vehicleInfo: string | null;
  endTime: string | null;
  boardingAddress: string | null;
  dropoffAddress: string | null;
};
