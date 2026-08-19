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
- `COBLI_API_KEY` — opcional; liga a telemetria real da Cobli (ver abaixo).
  Sem ela, a tela de Telemetria continua rodando com o fornecedor simulado.
- `CRON_SECRET` — segredo exigido pelas rotas agendadas
  (`/api/cron/tiquetaque-import`, `/api/cron/cobli-sync`), enviado como
  `Authorization: Bearer <segredo>`.

## Integração com a Cobli (telemetria)

A Cobli é o fornecedor de rastreamento/telemetria da frota. A integração vive
em `src/lib/cobli/` e entra no sistema pela mesma interface que o fornecedor
simulado já usava (`ITelemetryProvider`), então ligar ou desligar a Cobli não
muda nenhuma outra parte do produto.

- **Credencial**: gere uma chave no painel da Cobli em *Integrações > APIs* e
  publique como `COBLI_API_KEY`. A chave vai no header `Cobli-Api-Key` de cada
  requisição; a base é `https://api.cobli.co/`.
- **O que é sincronizado hoje**: a última posição conhecida de cada rastreador
  (`GET herbie-1.1/dash/device`), gravada como leitura de telemetria
  (velocidade + coordenadas) do veículo correspondente. O motor de excesso de
  velocidade (`src/lib/speedCompliance.ts`) passa a rodar sobre dado real.
- **Casamento com o cadastro**: por placa na primeira vez e, daí em diante,
  pelo id do rastreador gravado em `Vehicle.cobliDeviceId`. Rastreador sem
  veículo correspondente não vira leitura — aparece como "sem vínculo" no
  resultado da sincronização. Para trocar o equipamento de veículo, use
  *Desvincular* na tela do veículo.
- **Quando roda**: manualmente pelo botão em *Telemetria* e automaticamente
  pelo cron `/api/cron/cobli-sync` (06:00 UTC). O plano Hobby da Vercel só
  permite uma execução diária por cron; a mesma rota aceita ser chamada por um
  agendador externo com o `CRON_SECRET` para sincronizar com mais frequência.
- **Outros dados disponíveis na API deles** (mapeados em `COBLI_ENDPOINTS`,
  ainda não consumidos): checklists, comprovantes de conclusão, custos,
  incidentes e os relatórios de desempenho de veículo e de motorista — estes
  dois últimos respondem XLSX, não JSON.

## Deploy

Publicado no Vercel. O `vercel.json` roda `prisma migrate deploy` antes do
build, então as migrações são aplicadas automaticamente a cada push.
