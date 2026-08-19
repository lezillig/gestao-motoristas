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

Testes (não fazem rede, usam `fetch` simulado):

```bash
npm test
```

## Integração com o TiqueTaque

O ponto, os afastamentos e o cadastro de motoristas são sincronizados do
TiqueTaque, o sistema de ponto eletrônico oficial da empresa. A API v2.1
deles não tem documentação pública — o que já foi confirmado (endpoints que
existem, endpoints que **não** existem, limite de taxa e armadilhas reais)
está em [`docs/tiquetaque-api.md`](docs/tiquetaque-api.md).

Para descobrir quais recursos a API expõe, sem tentativa e erro manual:

```bash
npm run tiquetaque:discover
```

## Variáveis de ambiente em produção

- `DATABASE_URL` — string de conexão Postgres (Neon, Supabase, Vercel Postgres, etc.)
- `JWT_SECRET` — string aleatória usada para assinar a sessão
- `ANTHROPIC_API_KEY` — opcional; habilita a extração assistida por IA das
  regras da convenção coletiva. Sem ela, o cadastro manual de regras
  continua funcionando normalmente.
- `TIQUETAQUE_API_TOKEN` — token da API do TiqueTaque. Sem ela, as telas de
  importação ficam indisponíveis e o cron diário não roda.
- `CRON_SECRET` — segredo do `Authorization: Bearer` da importação diária
  D-1 agendada no `vercel.json`.
- `TIQUETAQUE_ALLOW_WRITES` — opcional, **desligada por padrão**. Só com
  `=1` o sistema pode escrever no TiqueTaque (criar/ajustar afastamento ou
  batida). O TiqueTaque é a fonte oficial do ponto eletrônico, e registro de
  ponto tem valor probatório: uma escrita errada altera a jornada legal de
  um funcionário real na fonte. Ver `docs/tiquetaque-api.md`.

## Deploy

Publicado no Vercel. O `vercel.json` roda `prisma migrate deploy` antes do
build, então as migrações são aplicadas automaticamente a cada push.
