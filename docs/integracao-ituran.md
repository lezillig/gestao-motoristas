# Integração com a Ituran

Como o sistema consome as posições dos rastreadores Ituran e o que precisa
ser pedido à Ituran para ligar a integração em produção.

## Situação

A Ituran **não publica documentação aberta** da API de integração: a URL
base, os caminhos e o formato de autenticação vêm no manual de integração
entregue por contrato, junto com as credenciais de API da conta de frota.
Por isso o código foi escrito para se adaptar ao contrato pela configuração,
e não para um endpoint fixo — ligar a integração é preencher variáveis de
ambiente, sem alterar código.

**O que pedir ao suporte/gerente de contas da Ituran:**

1. Acesso à API de integração da conta de frota (o produto costuma ser
   vendido à parte do portal web).
2. O manual de integração com: URL base, caminho de autenticação, caminho de
   consulta de posições, caminho de listagem de veículos e o formato de
   resposta de cada um.
3. As credenciais (token de API, ou usuário/senha de integração — não o
   login do portal web).
4. O limite de requisições por minuto e a frequência de atualização de
   posição contratada.

## Variáveis de ambiente

Sem `ITURAN_BASE_URL` + credencial, o sistema continua funcionando com o
provedor simulado — a tela de Telemetria não quebra, só mostra o selo
"simulado".

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `ITURAN_BASE_URL` | sim | — | URL base da API (ex.: `https://api.exemplo.ituran.com.br/v1`). Sem barra no fim. |
| `ITURAN_API_TOKEN` | uma das duas | — | Token estático. Tem precedência sobre usuário/senha. |
| `ITURAN_USERNAME` / `ITURAN_PASSWORD` | uma das duas | — | Credencial trocada por um token de sessão no endpoint de login. |
| `ITURAN_AUTH_PATH` | não | `/auth/login` | Caminho do login (só no modo usuário/senha). |
| `ITURAN_AUTH_USERNAME_FIELD` | não | `username` | Nome do campo de usuário no corpo do login (ex.: `usuario`). |
| `ITURAN_AUTH_PASSWORD_FIELD` | não | `password` | Nome do campo de senha no corpo do login (ex.: `senha`). |
| `ITURAN_AUTH_HEADER` | não | `Authorization` | Header que leva a credencial (ex.: `x-api-key`). |
| `ITURAN_AUTH_SCHEME` | não | `Bearer` | Prefixo do valor do header. Use string vazia para mandar o token cru. |
| `ITURAN_VEHICLES_PATH` | não | `/vehicles` | Listagem da frota (usada no "Testar conexão"). |
| `ITURAN_POSITIONS_PATH` | não | `/positions` | Consulta de posições por período. |
| `ITURAN_TIMEOUT_MS` | não | `15000` | Timeout por requisição. |

O cron também exige `CRON_SECRET` (já usado pela importação do TiqueTaque).

## Como ligar

1. Preencha as variáveis acima no projeto da Vercel (ou no `.env` local).
2. Abra **Telemetria** e clique em **Testar conexão** — ele lista a frota da
   conta sem gravar nada. Erro de credencial ou de caminho aparece com a
   mensagem que a Ituran devolveu.
3. Clique em **Sincronizar agora**. O resultado mostra quantas leituras
   entraram, quantas já existiam e quais placas monitoradas pela Ituran não
   têm veículo cadastrado.
4. A partir daí o cron diário (`/api/cron/ituran-sync`, ver `vercel.json`)
   mantém o histórico atualizado sozinho.

## Desenho

```
src/lib/ituran/config.ts   → o que muda por contrato (env), nada hardcoded
src/lib/ituran/parse.ts    → leitura tolerante do payload (funções puras)
src/lib/ituran/client.ts   → HTTP: login/token, retentativa, timeout
src/lib/telemetry/         → interface ITelemetryProvider + provedores
  ituranProvider.ts        → traduz posição da Ituran em leitura interna
  mockProvider.ts          → demonstração, sem credenciais
  sync.ts                  → grava no banco (incremental, sem duplicar)
```

Decisões que valem registro:

- **Casamento por placa**, normalizada dos dois lados (só letras e dígitos,
  maiúsculas). Cobre placa antiga e Mercosul, e `abc-1234` do cadastro casa
  com `ABC1234` da Ituran. Placa monitorada sem veículo cadastrado não é
  erro: aparece no resultado da sincronização como cadastro a corrigir.
- **Leitura tolerante do payload**: o mesmo código lê resposta em português
  ou inglês, array na raiz ou dentro de envelope (`data`, `posicoes`, …),
  data em ISO/`dd/MM/aaaa`/epoch e número com vírgula decimal. Campo
  obrigatório ilegível descarta a linha em vez de gravar dado inventado —
  posição sem fix de GPS (0,0) viraria um veículo no Golfo da Guiné, e
  velocidade "0 por falta de campo" apagaria um excesso real.
- **Data sem fuso é lida como horário de Brasília** (−03:00, fixo desde o
  fim do horário de verão em 2019). Ler como UTC jogaria toda leitura 3h
  para trás e desalinharia telemetria de escala e ponto.
- **Amostragem de 1 leitura a cada 5 min por veículo**, mas **toda** posição
  acima do limite legal é gravada. O rastreador reporta a cada poucos
  segundos; gravar tudo encheria a tabela com dezenas de milhares de linhas
  por dia sem acrescentar nada ao que o produto faz com o dado — exceto
  justamente as leituras de excesso, que são alerta e prova.
- **Sincronismo incremental e idempotente**: cada empresa parte da última
  leitura já gravada, e o índice único `(vehicleId, recordedAt, provider)`
  garante que uma janela sobreposta não duplique linha. Rodar de novo o
  mesmo período é seguro.
- **Hodômetro não atualiza `Vehicle.currentMileage`**: esse campo é fechado
  no checkout de utilização e alimenta o alerta de manutenção. Duas fontes
  escrevendo nele criariam divergência silenciosa entre o km do rastreador e
  o km declarado pelo motorista. O valor da Ituran fica em
  `TelemetryReading.odometerKm`, disponível para conferência.

## Trocar de fornecedor

Sascar, Onixsat ou qualquer outro: implemente `ITelemetryProvider`
(`src/lib/telemetry/types.ts`) e retorne a nova classe em
`getActiveTelemetryProvider()` (`src/lib/telemetry/index.ts`). Nenhuma outra
camada do produto muda — tela, cron e persistência só conhecem a interface.
