# Gestão de Motoristas

Sistema de controle operacional e financeiro para empresas de fretamento:
cadastro de motoristas com vínculo sindical, escalas, ponto (com checagem
automática de hora extra e interjornada), convenção coletiva (upload de PDF,
regras estruturadas e extração assistida por IA), utilização de veículos,
telemetria de velocidade e um módulo completo de **controladoria, auditoria e
financeiro** integrado à Omie.

## Controladoria (MOD.08)

Espelha o ERP Omie em D-1, roda dez agentes de auditoria sobre os dados
(contas a pagar e a receber, conciliação bancária, antifraude, custos, fiscal,
fluxo de caixa, rentabilidade, oportunidades e integridade do sistema), revisa
os achados com uma camada supervisora, mede um Balanced Scorecard e envia todo
dia um relatório gerencial e executivo por e-mail — que abre igual no
computador e no celular.

Documentação completa em [`docs/controladoria.md`](docs/controladoria.md):
estrutura dos agentes, conceitos de auditoria aplicados, unit economics
(custo por contrato/veículo/funcionário), segurança e trilha, e **o que
validar na primeira execução real contra a Omie**.

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
  regras da convenção coletiva e a leitura executiva do relatório diário de
  controladoria. Sem ela, o cadastro manual de regras continua funcionando e o
  relatório sai completo, apenas sem a seção de leitura executiva.
- `CRON_SECRET` — autentica as rotas agendadas (import do TiqueTaque e ciclo
  diário da controladoria).
- `OMIE_APP_KEY` / `OMIE_APP_SECRET` — credenciais da API da Omie. Sem elas o
  módulo de controladoria fica em modo "não configurado".
- `RESEND_API_KEY` — envio do relatório diário por e-mail. Sem ela o relatório
  é gerado e fica disponível no sistema, apenas não é enviado.
- `EMAIL_REMETENTE` — remetente do relatório; o domínio precisa estar
  verificado no Resend.
- `APP_URL` — URL pública do sistema, usada no botão do e-mail.

A lista completa de variáveis do módulo de controladoria está em
[`docs/controladoria.md`](docs/controladoria.md#8-variáveis-de-ambiente).

## Deploy

Publicado no Vercel. O `vercel.json` roda `prisma migrate deploy` antes do
build, então as migrações são aplicadas automaticamente a cada push.

Dois agendamentos diários:

- `0 5 * * *` — importação do ponto do TiqueTaque (D-1);
- `10 6 * * *` — ciclo da controladoria: sincroniza a Omie, roda a auditoria,
  mede o BSC e envia o relatório do dia.
