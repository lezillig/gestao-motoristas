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
- `TIQUETAQUE_API_TOKEN` — opcional; habilita a importação de ponto do
  TiqueTaque (manual e o cron diário).
- `OMIE_APP_KEY` / `OMIE_APP_SECRET` — opcionais; habilitam a integração com
  o Omie (ver abaixo). Sem elas a tela de integração fica visível mas
  desabilitada, e o cron devolve "Omie não configurado" sem erro.
- `CRON_SECRET` — segredo exigido no header `Authorization: Bearer ...` das
  rotas de cron (`/api/cron/*`). Sem ele as rotas respondem 401.

## Integração com o Omie (ERP financeiro)

Espelha, **só para leitura**, o cadastro de clientes e os títulos a pagar e a
receber do Omie — nada é escrito no ERP. O objetivo é cruzar receita e custo
por contrato com as horas que o sistema já apura (hora extra estrutural por
cliente), comparação que hoje exige exportar planilha dos dois lados.

- Tela: **Integrações → Omie** (`/integracoes/omie`), com sincronização
  manual e histórico de execuções.
- Automática: `/api/cron/omie-sync`, agendada no `vercel.json` às 06:00 UTC
  (03:00 de Brasília). Sincroniza clientes e depois os títulos com vencimento
  entre 45 dias atrás e 15 dias à frente — janela retroativa porque baixa,
  renegociação e cancelamento acontecem no ERP depois do vencimento.
- Credenciais: App Key e App Secret de uma aplicação criada no portal do
  desenvolvedor do Omie.

Cuidado principal ao mexer nesse código: a API do Omie bloqueia por até 30
minutos (HTTP 425) a combinação App Key + IP + método quando a mesma chamada
com erro é repetida. Por isso o cliente **não retenta** nada e paceia as
chamadas — ver `src/lib/omie/pace.ts`.

O casamento de clientes é por CNPJ/CPF e, só quando o cadastro local não tem
documento, por nome normalizado (nunca com mais de um candidato). O nome
cadastrado aqui nunca é sobrescrito pelo do ERP, e a criação de clientes
novos vindos do Omie é opt-in na tela — no cron nunca acontece.

## Deploy

Publicado no Vercel. O `vercel.json` roda `prisma migrate deploy` antes do
build, então as migrações são aplicadas automaticamente a cada push.
