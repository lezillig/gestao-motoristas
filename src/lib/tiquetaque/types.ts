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

// Folga/atestado/ferias/abono — GET /work-leaves?employee_id=... Datas vem
// como datetime completo no meio-dia UTC (ex. "2026-07-18T12:00:00+00:00"),
// entao nunca cruzam meia-noite local mesmo em UTC-3 — so pegamos os 10
// primeiros caracteres (AAAA-MM-DD), sem o mesmo cuidado de fuso que as
// celulas de data-só do Excel precisam.
export type TiqueTaqueLeave = {
  id: string;
  employeeId: string;
  leaveType: string; // "folga" | "atestado" | "ferias" | "abono", texto cru
  startDate: string; // AAAA-MM-DD
  endDate: string; // AAAA-MM-DD
  details: string | null;
  paidLeave: boolean;
};

// Localizacao [latitude, longitude] da batida, quando registrada via app com
// geolocalizacao (GET /times devolve isso por batida — confirmado real,
// nao documentado nos materiais publicos do TiqueTaque). Nula quando a
// batida nao teve GPS (ex. registro manual/web). So capturavel via
// importacao do TiqueTaque — nao existe pra lancamento manual.
export type TiqueTaqueLocation = [number, number];

// "type" da batida no TiqueTaque (ex.: "app" — registro pelo aplicativo de
// celular, com geolocalizacao; outros valores possiveis nao confirmados,
// exibido cru como veio da API) — confirmado real na mesma chamada que
// confirmou `location`.
export type TiqueTaquePunchPair = {
  entrada: string;
  saida: string | null;
  entradaLocation?: TiqueTaqueLocation | null;
  saidaLocation?: TiqueTaqueLocation | null;
  entradaType?: string | null;
  saidaType?: string | null;
};

// Uma batida CRUA do TiqueTaque, como GET /times devolve, sem o pareamento
// entrada/saida de pairing.ts. Existe porque o pareamento e lossy de
// proposito (agrupa em dias e descarta o que nao vira par) e algumas
// perguntas so podem ser respondidas com a batida individual: qual foi a
// justificativa de uma marcacao invalidada, quais batidas ainda estao
// pendentes de aprovacao, qual foi a marcacao exata reprovada numa auditoria.
// `justification` e o texto que o TiqueTaque guarda ao invalidar uma batida
// (ex.: "Duplicidade de registro", "DUPLICADO") — confirmado real na mesma
// investigacao que descobriu `type: "desconsiderado"` (ver pairing.ts).
export type TiqueTaqueRawPunch = {
  id: string | null;
  employeeId: string | null;
  /** Datetime completo como veio ("AAAA-MM-DDTHH:mm:ss..."). */
  time: string;
  approved: boolean;
  location: TiqueTaqueLocation | null;
  /** "app", "desconsiderado", etc. — texto cru, nao normalizado. */
  type: string | null;
  justification: string | null;
};

// Departamento ("unidade de alocacao" na UI) com quantos funcionarios ativos
// ele tem. NAO vem de um endpoint proprio: e agregado de
// contract_data.department dos funcionarios. A API publica v2.1 nao expoe
// colecao de departamentos — o que existe e esse texto livre por
// funcionario. Ver docs/tiquetaque-api.md.
export type TiqueTaqueDepartment = {
  name: string;
  employeeCount: number;
};

// Empregador legal (razao social de um dos CNPJs reais da empresa), vindo de
// GET /payment-sources, com a contagem de funcionarios ativos vinculados.
export type TiqueTaqueEmployer = {
  id: string;
  name: string;
  employeeCount: number;
};

// Campos aceitos ao criar/ajustar um afastamento (POST/PATCH /work-leaves).
export type TiqueTaqueLeaveInput = {
  employeeId: string;
  leaveType: string;
  /** AAAA-MM-DD */
  startDate: string;
  /** AAAA-MM-DD */
  endDate: string;
  details?: string | null;
  paidLeave?: boolean;
};

// Campos aceitos ao criar/ajustar uma batida (POST/PATCH /times).
export type TiqueTaquePunchInput = {
  employeeId: string;
  /** Datetime completo, ex. "2026-08-19T07:03:00+00:00". */
  time: string;
  approved?: boolean;
  location?: TiqueTaqueLocation | null;
  justification?: string | null;
};

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
