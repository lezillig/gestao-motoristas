import type { LwCondutorDTO, LwImagemDTO, LwMultaDTO, LwVeiculoDTO } from "./types";

const LW_BASE_URL = "https://api.lwtecnologia.com.br/api";

export function isLwAvailable(): boolean {
  return Boolean(process.env.LW_API_LOGIN && process.env.LW_API_SENHA);
}

// O corpo de POST /login ja devolve o token com o prefixo "Bearer " incluso
// (confirmado real 2026-09-09) — usar direto no header Authorization, sem
// prefixar de novo (senao a LW responde 403 Forbidden). Sem cache/renovacao
// entre chamadas, mesmo espirito de simplicidade do cliente SIAT/Ituran: uso
// pouco frequente (sync manual/periodico), busca um token novo por execucao.
export async function getLwToken(): Promise<string> {
  const login = process.env.LW_API_LOGIN;
  const senha = process.env.LW_API_SENHA;
  if (!login || !senha) {
    throw new Error("Credenciais da LW Tecnologia não configuradas (LW_API_LOGIN/LW_API_SENHA).");
  }
  const res = await fetch(`${LW_BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, senha }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LW respondeu ${res.status} ao autenticar: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("LW não devolveu token.");
  return data.token;
}

async function lwGet<T>(token: string, path: string): Promise<T | null> {
  const res = await fetch(`${LW_BASE_URL}${path}`, { headers: { Authorization: token } });
  // 204 = sem conteudo (placa sem multa/condutor cadastrado) — nao e erro.
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LW respondeu ${res.status} em ${path}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function lwPost<T>(token: string, path: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${LW_BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`LW respondeu ${res.status} em ${path}: ${errBody.slice(0, 300)}`);
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

// Busca multas por placa — a LW aceita a placa em mais de uma grafia
// dependendo de como o veiculo foi cadastrado do lado dela (formato antigo
// vs Mercosul, e as vezes o mesmo erro de digitacao "I" no lugar de "1" que
// a Ituran comete, confirmado real 2026-09-09). Quem chama deve tentar as
// variantes plausiveis (ver src/lib/plate.ts:platePhysicalVariants) e juntar
// os resultados por `id`, nao assumir uma unica grafia certa.
export async function buscarMultasPorPlaca(token: string, placa: string): Promise<LwMultaDTO[]> {
  const result = await lwGet<LwMultaDTO[]>(token, `/multas/buscarMulta/${encodeURIComponent(placa)}`);
  return result ?? [];
}

export async function buscarCondutorPorCpfEMulta(
  token: string,
  cpf: string,
  numeroRegistro: string
): Promise<LwCondutorDTO | null> {
  return lwGet<LwCondutorDTO>(
    token,
    `/indicacao/buscarCondutorPorCpf/${encodeURIComponent(cpf)}/${encodeURIComponent(numeroRegistro)}`
  );
}

// Cadastro completo de veiculos da LW — usado uma vez por sincronizacao
// (nao por veiculo) pra descobrir sob qual grafia cada placa esta cadastrada
// do lado de la, ver src/lib/lw/plateMatch.ts.
export async function listarVeiculosLw(token: string): Promise<LwVeiculoDTO[]> {
  const result = await lwGet<LwVeiculoDTO[]>(token, `/veiculos/todosVeiculos`);
  return result ?? [];
}

// Indica o condutor responsavel por uma multa (efeito juridico real — so
// deve ser chamado apos confirmacao humana explicita, nunca automaticamente
// a partir da sugestao da resolucao automatica). Pressupoe que o condutor
// JA esta cadastrado do lado da LW (ver buscarCondutorPorCpfEMulta acima) —
// esta app nao tenta cadastrar um condutor novo na LW, porque o cadastro
// completo (POST /indicacao/cadastrar_condutor) exige endereco e data de
// nascimento que o cadastro de Driver deste sistema nao coleta hoje.
export async function indicarCondutorLw(
  token: string,
  input: { cpfCondutor: string; idMulta: number; numeroRegistro: string }
): Promise<void> {
  await lwPost(token, `/indicacao/indicar_condutor`, {
    cpf_condutor: input.cpfCondutor,
    id_multa: input.idMulta,
    numero_registro: input.numeroRegistro,
    numero_registro_pid: null,
  });
}

export async function statusIndicacao(
  token: string,
  idMulta: string
): Promise<{ status: number; status_descricao: string; mensagens_erro: unknown[] } | null> {
  return lwGet(token, `/indicacao/statusIndicacao/${encodeURIComponent(idMulta)}`);
}

// Imagem da notificacao oficial da multa. Prioriza o endpoint especifico de
// notificacao ("N") e cai pro endpoint mais generico (que tambem cobre
// "NS" — notificacao generica — e outras referencias) so se o primeiro nao
// trouxer nada — confirmado real 2026-09-09 que os dois podem coexistir com
// referencias diferentes pra mesma multa.
export async function buscarPrimeiraImagemMulta(token: string, idMulta: string): Promise<LwImagemDTO | null> {
  const notificacao = await lwGet<LwImagemDTO[]>(token, `/multas/buscarImagemNotificacao/${encodeURIComponent(idMulta)}`);
  if (notificacao && notificacao.length > 0) return notificacao[0];
  const outras = await lwGet<LwImagemDTO[]>(token, `/multas/buscarImagensMulta/${encodeURIComponent(idMulta)}`);
  return outras?.[0] ?? null;
}
