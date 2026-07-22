export type TiqueTaqueEmployee = {
  id: string;
  fullName: string;
  cpf: string;
};

// Um dia de trabalho ja pareado a partir das batidas avulsas do TiqueTaque
// (o endpoint /times devolve batidas soltas, nao pares entrada/saida).
export type TiqueTaqueDayEntry = {
  date: string; // AAAA-MM-DD
  clockIn: string; // HH:mm
  clockOut: string | null; // HH:mm, nulo se so teve 1 batida (turno aberto)
  intervaloInicio: string | null; // HH:mm, so quando ha exatamente 4 batidas no dia
  intervaloFim: string | null;
};
