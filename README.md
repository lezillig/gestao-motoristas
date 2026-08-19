# Gestão de Motoristas

Sistema de controle operacional para empresas de fretamento: cadastro de
motoristas com vínculo sindical, escalas, ponto (com checagem automática de
hora extra e interjornada), convenção coletiva (upload de PDF, regras
estruturadas e extração assistida por IA), utilização de veículos e
telemetria de velocidade.

## Stack

Next.js 16 + Prisma 6 (PostgreSQL) + Tailwind v4.

## Desenvolvimento local

```bash
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Requer um `DATABASE_URL` de Postgres em `.env` (ver `.env` para o formato).
Login de demonstração após o seed: `admin@exemplo.com` / `admin123`.

## Variáveis de ambiente em produção

- `DATABASE_URL` — string de conexão Postgres (Neon, Supabase, Vercel Postgres, etc.)
- `JWT_SECRET` — string aleatória usada para assinar a sessão
- `ANTHROPIC_API_KEY` — opcional; habilita a extração assistida por IA das
  regras da convenção coletiva. Sem ela, o cadastro manual de regras
  continua funcionando normalmente.
- `SOFIT_*` — opcional; integração com o sistema de gestão de frota Sofit
  (ver seção abaixo). Sem elas, a tela de integrações mostra a integração
  como "Desligada" e nada mais no sistema é afetado.

## Integração com o Sofit (gestão de frota)

Traz do Sofit para cá: **veículos**, **abastecimentos**, **manutenções** e
**odômetro**. A tela fica em **Integrações → Sofit** (`/integracoes/sofit`),
com teste de conexão, sincronização manual por período e histórico das
execuções. Há também um agendamento diário (`/api/cron/sofit-sync`, 06:00
UTC = 03:00 de Brasília) que sincroniza de forma incremental, desde a última
execução bem-sucedida de cada entidade.

Para onde cada dado vai:

| Entidade no Sofit | Destino aqui                                                          |
| ----------------- | --------------------------------------------------------------------- |
| Veículos          | `Vehicle` (casado pela placa; cria o que falta, completa o que existe)  |
| Abastecimentos    | `FuelTransaction` (aparece em **Combustível**)                          |
| Manutenções       | `Vehicle.lastMaintenanceMileage` (contador de manutenção preventiva)    |
| Odômetro          | `Vehicle.currentMileage`                                                |

Regras que valem para todas: reexecutar o mesmo período **não duplica** nada
(abastecimento é deduplicado pelo código do Sofit), campo ausente no Sofit
**não apaga** o valor já preenchido aqui, e o hodômetro só anda para frente.

### Variáveis de ambiente

Obrigatórias para ligar a integração:

- `SOFIT_API_URL` — URL base da API (ex.: `https://api.sofit.com.br/v1`)
- `SOFIT_API_TOKEN` — token de acesso; **ou** `SOFIT_USERNAME` +
  `SOFIT_PASSWORD` quando a instalação usa login para obter o token

Opcionais, para ajustar ao contrato acordado com o Sofit na implantação (os
valores padrão estão entre parênteses):

- `SOFIT_AUTH_MODE` — `bearer` | `basic` | `header` | `login` (deduzido pela
  credencial configurada)
- `SOFIT_TOKEN_HEADER` — header usado no modo `header` (`X-API-Key`)
- `SOFIT_LOGIN_PATH`, `SOFIT_LOGIN_CAMPO_USUARIO`, `SOFIT_LOGIN_CAMPO_SENHA`
  — modo `login` (`/auth/login`, `usuario`, `senha`)
- `SOFIT_PATH_VEICULOS`, `SOFIT_PATH_ABASTECIMENTOS`, `SOFIT_PATH_MANUTENCOES`,
  `SOFIT_PATH_ODOMETRO`, `SOFIT_PATH_MOTORISTAS` (`/veiculos`,
  `/abastecimentos`, `/manutencoes`, `/odometros`, `/motoristas`)
- `SOFIT_PARAM_PAGINA`, `SOFIT_PARAM_TAMANHO`, `SOFIT_PARAM_DATA_INICIO`,
  `SOFIT_PARAM_DATA_FIM`, `SOFIT_PRIMEIRA_PAGINA` (`page`, `size`,
  `dataInicio`, `dataFim`, `1`)
- `SOFIT_PAGE_SIZE`, `SOFIT_TIMEOUT_MS` (`200`, `20000`)
- `SOFIT_WEBHOOK_SECRET` — habilita o recebimento por push (abaixo). Sem ela,
  a rota de webhook responde 404.
- `CRON_SECRET` — segredo do agendamento (compartilhado com o cron do
  TiqueTaque); o Vercel o envia como `Authorization: Bearer …`.

A API do Sofit é liberada por contrato e o mapeamento de campos é acordado na
implantação — por isso caminhos e nomes de parâmetro são configuráveis, e a
leitura dos campos de cada registro aceita apelidos (`placa`/`veiculoPlaca`/
`plate`, `litros`/`quantidade`/`volume`, …). Todo esse conhecimento está em
`src/lib/sofit/normalize.ts`: quando o contrato real chegar, é o único
arquivo que precisa ser enxugado.

### Recebimento por push (opcional)

Quando for o Sofit (ou um intermediário) a enviar os dados, use:

```
POST /api/integracoes/sofit/webhook
Authorization: Bearer $SOFIT_WEBHOOK_SECRET
Content-Type: application/json

{ "tipo": "ABASTECIMENTOS", "dados": [ { "placa": "ABC1D23", ... } ] }
```

`tipo` aceita `VEICULOS`, `ABASTECIMENTOS`, `MANUTENCOES` ou `ODOMETRO`
(singular também). Máximo de 1000 registros por requisição; o corpo passa
pelos mesmos normalizadores e pelas mesmas gravações da sincronização ativa,
e cada envio aparece no histórico da tela com origem "Push do Sofit".

## Deploy

Publicado no Vercel. O `vercel.json` roda `prisma migrate deploy` antes do
build, então as migrações são aplicadas automaticamente a cada push, e
declara os dois agendamentos diários (TiqueTaque às 05:00 UTC, Sofit às 06:00
UTC) — o plano Hobby permite no máximo dois, então um agendamento novo exige
avaliar o plano.
