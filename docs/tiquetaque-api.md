# API do TiqueTaque — o que se sabe

A API v2.1 do TiqueTaque não tem documentação pública. Tudo aqui foi obtido
contra a API real, em produção, e vale como o registro do que já foi
confirmado — para que a próxima pessoa não repita a mesma investigação por
tentativa e erro.

- **Base:** `https://api.tiquetaque.com/v2.1`
- **Autenticação:** HTTP Basic, usuário fixo `public`, senha = token
  (`Authorization: Basic base64("public:" + TIQUETAQUE_API_TOKEN)`)
- **Limite de taxa:** 60 requisições/minuto (a API responde `429` com
  `"60 per 1 minute"`). Confirmado com 429 reais numa importação que
  disparava uma chamada por motorista, sem pausa, para 300+ motoristas.
- **Framework:** Python-Eve. Isso não é trivialidade: define o envelope das
  coleções, o contrato de escrita (ETag) e a existência do documento raiz de
  descoberta. Ver "Convenções do Eve" abaixo.

## Recursos confirmados

| Recurso | Uso | Envelope |
|---|---|---|
| `GET /employees` | Funcionários (nome, CPF, cargo, departamento, valor-hora, empregador, desligamento) | Eve |
| `GET /payment-sources` | Empregador legal — razão social por CNPJ | Eve |
| `GET /times` | Batidas avulsas por funcionário e período | **`{times: [...]}`, fora do padrão Eve** |
| `GET /work-leaves` | Folga, atestado, férias e abono | Eve |

`/work-leaves` cobre de uma vez três itens do menu "Gestão de ponto" do
painel web (Escala de folgas, Afastamentos, Férias).

## Recursos confirmados AUSENTES

Investigados contra a API real e respondendo `404` — não insista sem antes
rodar o descobridor:

- **Banco de horas** (saldo) — sem endpoint público
- **Sobreaviso** — sem endpoint público
- **"Unidade"** — o filtro visto no painel web (ex.: AACD, Banco de
  Alimentos) é um campo *diferente* de `contract_data.department` e não
  existe na API pública. O que temos é o departamento por funcionário, que
  na prática tem granularidade de contrato/rota ("ESCOLAR - SUL 01").
- **Departamentos** — não há coleção própria; a lista é agregada de
  `contract_data.department` dos funcionários (`fetchDepartments()`).

## Descobrindo novos endpoints

Não escreva um wrapper para um recurso que você não confirmou existir. O
descobridor pergunta à própria API:

```bash
npm run tiquetaque:discover                       # lista + sonda todos os candidatos
npm run tiquetaque:discover -- --json             # saída para arquivo
npm run tiquetaque:discover -- justifications     # sonda um recurso específico
```

Ele lê o documento raiz do Eve (`GET /`), que anuncia todos os recursos
expostos, e sonda cada candidato com um `GET ...?max_results=1`, relatando o
status HTTP, os verbos do cabeçalho `Allow` e os campos do primeiro item.
Só faz leitura. Exige `TIQUETAQUE_API_TOKEN` (do ambiente ou do `.env`) e
respeita o limite de 60 req/min pausando ~1,1s entre as sondagens.

Confirmou um recurso novo? Escreva o wrapper em
`src/lib/tiquetaque/resources.ts` e **registre o achado nesta tabela** —
inclusive os 404, que valem tanto quanto os acertos.

## Convenções do Eve

- **Coleções** respondem `{_meta: {total, page, max_results}, _items: [...]}`.
  Paginação por `?max_results=200&page=N` — use `fetchAllPages()`, que já
  trata o fim da varredura e tem teto contra laço infinito.
- **Itens** trazem `_id` e `_etag`.
- **Escrita:** `POST` na coleção; `PATCH`/`DELETE` no item **com
  `If-Match: <_etag>`**. ETag desatualizada responde `412` — releia o item e
  refaça. `fetchItemEtag()` faz a leitura prévia.
- `/times` **não** segue esse padrão na leitura, então o comportamento de
  escrita dele não é garantido — ver "Escrita" abaixo.

## Escrita: desligada por padrão

Escritas exigem `TIQUETAQUE_ALLOW_WRITES=1`. Sem a variável, as funções
falham antes de tocar a rede.

O motivo é concreto: o TiqueTaque é o sistema de ponto eletrônico **oficial**
da empresa, e registro de ponto tem valor probatório — é a mesma razão pela
qual este projeto mantém trilha de auditoria com hash
(`src/lib/integrity.ts`). Uma escrita errada, vinda de um bug ou de um teste
apontado para produção, altera a jornada legal de um funcionário real na
fonte, fora do alcance da nossa trilha.

`createLeave`/`updateLeave`/`deleteLeave` seguem o contrato Eve, que vale
para `/work-leaves`. Já `createPunch`/`updatePunch`/`deletePunch` **não
foram confirmados contra a API real**: `/times` foge do padrão Eve na
leitura, então pode fugir na escrita também. Confirme com o descobridor
(a coluna `allow=`) e teste com um registro antes de ligar isso em qualquer
fluxo automático. Para invalidar uma batida, prefira `updatePunch` marcando
justificativa a apagar o registro — o próprio TiqueTaque invalida com
`type: "desconsiderado"` + justificativa, preservando o histórico.

## Armadilhas já encontradas (todas com bug real por trás)

- **`full_name` vem com espaço no fim** às vezes ("CLEBSON MAURO DA SILVA ").
  Ia direto para `Driver.name` e quebrava todo casamento exato por nome.
  `fetchAllEmployees()` já apara.
- **Funcionário sem CPF** existe (só NIS). Sem CPF não há como casar com o
  nosso `Driver`, então esses ficam de fora da importação.
- **Batida inválida vem com `approved: true`.** O TiqueTaque marca a
  invalidação em `type: "desconsiderado"` (com `justification`, ex.
  "Duplicidade de registro"). Filtrar só por `approved` deixava passar
  batida fantasma, que desalinhava a paridade entrada/saída do dia e gerava
  jornada de mais de 24h. Ver `pairing.ts`.
- **`/times` devolve batidas soltas, sem rótulo de entrada/saída.** O
  pareamento é heurístico (`pairing.ts`) e tem teto de plausibilidade de
  turno de 14h. Para a marcação individual crua, use `fetchRawPunches()`.
- **Datas de `/work-leaves`** vêm como `AAAA-MM-DDT12:00:00+00:00` (meio-dia
  UTC). Nunca cruzam a meia-noite local em UTC-3, então os 10 primeiros
  caracteres já são a data correta. A escrita usa o mesmo formato.
- **`429` no meio de um lote** já matou uma invocação inteira do cron: o
  backoff da retentativa (até 14s) estourava o teto de 60s da Vercel no
  plano Hobby. Chamadores com teto rígido devem passar `deadline`, que faz a
  retentativa desistir em vez de dormir além do orçamento.

## Onde fica o quê

| Arquivo | Papel |
|---|---|
| `src/lib/tiquetaque/http.ts` | Transporte: auth, retentativa de 429, erros tipados, paginação, trava de escrita |
| `src/lib/tiquetaque/resources.ts` | Wrappers por recurso — **só de recurso confirmado** |
| `src/lib/tiquetaque/discovery.ts` | Descoberta e sondagem de endpoints |
| `src/lib/tiquetaque/pairing.ts` | Pareamento das batidas avulsas em dias |
| `src/lib/tiquetaque/importCore.ts` | Importação por motorista (reconciliação + auditoria) |
| `src/lib/tiquetaque/csvImport.ts` | Importação da planilha oficial de exportação em massa |
| `src/lib/tiquetaque/pace.ts` | Pausa entre chamadas dos laços de importação |
| `src/lib/tiquetaque/client.ts` | Fachada de compatibilidade (código novo deve importar de `resources.ts`) |

Erros tipados: `TiqueTaqueApiError` expõe `isNotFound`, `isUnauthorized`,
`isMethodNotAllowed`, `isRateLimited` e `isPreconditionFailed` — trate o
caso em vez de casar substring de mensagem.

Testes: `npm test` (não faz rede; usa um `fetch` simulado).
