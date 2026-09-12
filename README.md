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
  regras da convenção coletiva e o Assistente da operação (`/assistente`).
  Sem ela, o cadastro manual de regras continua funcionando normalmente.
- `RESEND_API_KEY` — opcional; habilita o e-mail diário do painel Hoje
  (cron `/api/cron/hoje-email`, 07h de Brasília) e o botão "Enviar por
  e-mail pra mim" em `/hoje`.
- `HOJE_EMAIL_PARA` — destinatários do e-mail diário, separados por vírgula.
- `EMAIL_FROM` — opcional; remetente (ex.: `Gestão de Motoristas <hoje@seudominio.com.br>`,
  domínio verificado na Resend). Sem ele usa `onboarding@resend.dev`, que só
  entrega para o e-mail dono da conta Resend.
- `APP_BASE_URL` — opcional; URL pública usada nos links do e-mail
  (padrão: origem da requisição).

## Deploy

Publicado no Vercel. O `vercel.json` roda `prisma migrate deploy` antes do
build, então as migrações são aplicadas automaticamente a cada push.
