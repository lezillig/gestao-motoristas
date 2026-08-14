export type TiqueTaqueEmployee = {
  id: string;
  fullName: string;
  cpf: string;
  jobRole: string;
  dismissed: boolean;
  mobilePhone: string | null;
  hourRateCents: number | null;
  // Departamento (contract_data.department), texto livre do TiqueTaque, so
  // aparado. paymentSourceId referencia GET /payment-sources (razao social
  // do empregador legal — a empresa tem mais de um CNPJ/empregador reais,
  // ex. "Azul Transportes e Turismo LTDA", "MCZ Transportes..."), resolvido
  // pra nome em fetchPaymentSources(). Nao existe campo "Unidade"/cliente na
  // API publica — ver comentario no schema, model Driver.
  department: string | null;
  paymentSourceId: string | null;
};

export type TiqueTaquePunchPair = { entrada: string; saida: string | null };

// Um dia de trabalho ja pareado a partir das batidas avulsas do TiqueTaque
// (o endpoint /times devolve batidas soltas, nao pares entrada/saida). Um
// dia pode ter mais de 1 par (mais de uma pausa) — `pairs` guarda todos,
// em ordem; clockIn/clockOut/intervalo* refletem so o primeiro e o ultimo
// par, mantidos para exibicao simples nas telas que ainda nao mostram a
// lista completa.
export type TiqueTaqueDayEntry = {
  date: string; // AAAA-MM-DD
  clockIn: string; // HH:mm
  clockOut: string | null; // HH:mm, nulo se o ultimo par ainda nao tem saida (turno aberto)
  intervaloInicio: string | null; // HH:mm, fim do primeiro par (so quando ha mais de 1 par)
  intervaloFim: string | null; // HH:mm, inicio do segundo par
  pairs: TiqueTaquePunchPair[];
};
