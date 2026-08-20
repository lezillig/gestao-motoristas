# Módulo de Controladoria, Auditoria e Financeiro

Sistema de controladoria ligado à API da Omie: espelha o ERP em D-1, roda uma
bateria de agentes de auditoria sobre os dados, mede um Balanced Scorecard e
envia um relatório gerencial e executivo por e-mail todos os dias.

---

## 1. Como funciona, em uma passada

```
Omie (ERP)  ──sync D-1──▶  espelho local  ──▶  10 agentes  ──▶  supervisor  ──▶  achados
                                │                                                   │
                                ├──▶ analytics (DRE, caixa, comparativos)           │
                                ├──▶ BSC (4 perspectivas, metas, faróis)            │
                                └──▶ unit economics (custo por contrato/veículo)    │
                                                          │                          │
                                                          └──▶ analista (IA) ──▶ relatório diário (e-mail)
```

Tudo isso roda numa única rota agendada (`/api/cron/controladoria`), como uma
máquina de estados que se auto-encadeia — ver a seção 6.

---

## 2. Estrutura de agentes

A escolha por **três camadas** (e não por um único agente grande, nem por
dezenas de agentes pequenos) é o que dá confiança ao resultado:

### Camada 1 — Dez agentes de domínio

Determinísticos e puros: recebem o mesmo retrato dos dados, não consultam banco
nem API, não escrevem nada. Cada um responde a uma pergunta que tem um **dono
diferente na empresa** — é por isso que são dez, e não três ou trinta: agentes
demais fragmentariam a mesma pergunta em várias caixas de entrada; agentes de
menos misturariam responsabilidades e impediriam endereçar o achado a alguém.

| Agente | Área responsável | O que procura |
|---|---|---|
| `contas-pagar` | Financeiro | Juros e multa por atraso, duplicidade, pagamento acima do documento, títulos vencidos e "fantasma", antecipação sem desconto, falta de classificação |
| `contas-receber` | Financeiro | Inadimplência por cliente, aging, descontos concedidos, recebimento a menor, concentração de receita, cliente que atrasa sistematicamente |
| `conciliacao-bancaria` | Financeiro | Movimentos não conciliados, saída sem título, baixa sem dinheiro no extrato, débitos duplicados, saldo abaixo do mínimo |
| `antifraude` | Controladoria | Troca de conta bancária de fornecedor, fracionamento de alçada, fornecedor que é funcionário, documento inválido, cadastro duplicado, pagamento em dia não útil, fornecedor novo com valor alto, desvio da Lei de Benford |
| `custos` | Controladoria | Variação por categoria, despesa nova, gasto recorrente sem revisão, valor fora do padrão do fornecedor, divergência entre combustível na Omie e no cartão de frota, concentração de fornecedor |
| `fiscal` | Contabilidade | Nota cancelada com título ativo, receita sem nota, nota sem título, carga tributária fora da faixa do Lucro Presumido, falha na sequência de numeração |
| `fluxo-caixa` | Tesouraria | Projeção de saldo em 7/15/30/60/90 dias, descasamento da semana, ciclo financeiro (PMR/PMP) |
| `rentabilidade` | Controladoria | Margem por contrato, contrato no prejuízo, contrato abaixo da meta, veículo com custo fora do padrão, cobertura do rateio |
| `oportunidades` | Controladoria | **Onde reduzir custo** (ver seção 4), juros evitáveis anualizados, tarifas bancárias, consolidação de fornecedores, política de alçadas sugerida |
| `administrativo` | Administrativo | Sync atrasado ou com erro, cadastro incompleto, conta sem extrato, achados críticos sem tratativa |

Um agente que quebra **não derruba os outros nove**: o erro é registrado na
execução e o relatório do dia sai com o que deu certo.

### Camada 2 — Supervisor

`src/lib/controladoria/supervisor.ts`. Nenhum achado chega ao painel ou ao
e-mail sem passar por ele. Existe porque um agente determinístico sempre "tem
certeza" do que calculou, mas não consegue saber:

1. **Se o dado que leu estava completo.** Sem extrato importado, a regra "baixa
   sem movimento bancário" acusa centenas de falsos positivos — todos
   tecnicamente corretos e todos errados. O supervisor suprime a família
   inteira de regras que depende do dado ausente.
2. **Se outro agente já apontou o mesmo fato** por outro caminho — consolida e
   mantém o segundo como corroboração, rebaixado.
3. **Se aquele achado já foi julgado inaplicável por uma pessoa** — volta como
   INFO, com nota, respeitando a tratativa anterior.
4. **Se está gritando "crítico" mais alto que os outros 40 achados** — calibra:
   no máximo 5 críticos por execução, priorizados por impacto financeiro.

Ele também checa coerência aritmética (valor negativo ou acima do total da base
= erro de cálculo, o achado é descartado em vez de "corrigido"), penaliza
achado sem evidência e ajusta a **confiança** de toda a rodada pela qualidade da
base. Quando intervém, escreve o porquê em `notaSupervisor`, visível ao lado do
achado — revisão invisível seria indistinguível de censura.

### Camada 3 — Analista (IA)

`src/lib/controladoria/aiAnalyst.ts`, usando `claude-opus-5`. Lê **apenas** os
números já calculados e os achados já validados, e escreve a leitura executiva
do relatório. Não cria, não apaga e não altera achado nenhum: se pudesse
produzir os próprios "fatos", o relatório deixaria de ser auditável. Sem
`ANTHROPIC_API_KEY`, o relatório sai completo, apenas sem essa seção.

---

## 3. Conceitos que sustentam a qualidade dos achados

**Materialidade** — o que é "muito dinheiro" não é um número fixo, é 0,5% do
total pago no ano (piso de R$ 500). Um limiar chumbado ficaria grosseiro para
uma empresa que cresce e sensível demais para uma que encolhe — e encheria a
tela de achado irrelevante no primeiro mês, que é como um sistema de auditoria
morre.

**Achado de ESTADO x de EVENTO** — "título vencido em aberto" é estado: some
sozinho quando o título é pago, e o motor o encerra como `OBSOLETO`. "Pagou
R$ 320 de juros em 14/02" é evento: nunca deixa de ser verdade, e só uma pessoa
o encerra. A distinção importa no indicador de controle interno — "resolvemos
40 achados" é diferente de "40 sumiram sozinhos".

**Chave determinística** — o mesmo fato, reavaliado amanhã, produz a mesma
chave e reencontra o achado, preservando a tratativa que alguém escreveu nele.
É o que permite rodar a auditoria todo dia sem a lista virar lixo.

**Valor x impacto** — `valorCents` é o dinheiro do fato (o que já saiu);
`impactoCents` é o que dá para evitar/recuperar daqui para frente. Somar os
dois no mesmo campo inflaria o total do relatório.

---

## 4. Onde reduzir custo (capacidade estratégica)

`src/lib/controladoria/estrategiaCusto.ts`, usado pelo agente de oportunidades.

Reduzir custo é meta; saber **onde** reduzir é estratégia. Corte linear ("todos
reduzem 10%") trata igual o que é desigual: corta o combustível que leva o
passageiro na mesma proporção do contrato que ninguém usa mais. O módulo cruza
dois eixos:

1. **Peso** — quanto a categoria representa do custo total (Pareto: as
   categorias que formam os primeiros 80%).
2. **Acoplamento à receita** — o custo sobe e desce junto com o faturamento, ou
   segue o próprio caminho?

Daí saem quatro classificações e três tratamentos distintos:

| Classificação | Significado | O que fazer |
|---|---|---|
| **Cresce sem a receita crescer** | Aumento sem contrapartida de entrega | Alvo prioritário: identificar o que entrou (fornecedor novo, reajuste, escopo ampliado) e cortar |
| **Estrutura (fixo)** | Estável, independente do volume | Renegociar contrato/escopo — efeito permanente, mês a mês |
| **Acompanha a entrega (variável)** | É o custo de prestar o serviço | **Não cortar**: buscar eficiência (custo por km, por hora). Cortar aqui é entregar menos |
| **Histórico insuficiente** | Menos de 4 meses de base | Acompanhar antes de decidir |

Com menos de 4 meses de histórico o módulo **diz isso** em vez de recomendar
corte a partir de dois pontos — uma recomendação errada de onde cortar custa
mais caro que a ausência dela.

---

## 5. Unit economics: custo por contrato, veículo e funcionário

`src/lib/controladoria/unitEconomics.ts`. Duas decisões sustentam o número:

**Nada é inventado.** Um custo só é atribuído quando existe ligação
verificável: um de-para de centro de custo **confirmado por uma pessoa**
(`OmieVinculoCentroCusto`), uma placa citada no próprio documento do título, ou
um dado que já nasce vinculado (o abastecimento do cartão de frota, que tem
veículo e motorista). O resto vai para "não alocado".

**A cobertura é um número de primeira classe.** Dizer "o contrato X custa
R$ 120 mil" escondendo que 40% do custo não foi alocado é pior que não dizer
nada. Abaixo de 70% de cobertura, a tela e o agente **não publicam** o ranking
de rentabilidade — publicam o alerta de que a base ainda não sustenta a
conclusão, e o caminho para melhorá-la.

---

## 6. Ciclo diário

Uma única rota agendada, como máquina de estados com cursor persistido:

```
cadastros → títulos → movimentos → notas → auditoria → relatório
```

Cada invocação trabalha ~42s, grava onde parou em `OmieSyncRun` (fase +
cursor) e dispara a próxima via `waitUntil` — o mesmo desenho já validado em
produção pelo import do TiqueTaque, pela mesma razão: o plano Hobby da Vercel
tem 60s de teto duro por invocação.

**Carga histórica (backfill)** usa a mesma máquina, mês a mês desde
`dataInicioBase`, sem gerar relatório (disparar um e-mail por mês carregado
seria absurdo). Quando alcança o mês corrente, o ciclo diário assume.

**Agendamento:** `10 6 * * *` UTC = 03:10 de Brasília, depois do fechamento
bancário e antes do expediente. Uma rota só, e não duas, porque o plano Hobby
permite poucos agendamentos e este projeto já usa um para o TiqueTaque — e,
de quebra, isso garante que o relatório nunca saia antes do sync terminar.

---

## 7. Segurança e rastreabilidade

- **Credenciais só em variável de ambiente.** Nunca no banco, nunca em tela. O
  cliente da Omie remove qualquer eco de `app_key`/`app_secret` das mensagens
  de erro antes de elas virarem texto persistido (a Omie ecoa a chave dentro da
  própria faultstring em erros de autenticação).
- **Dados bancários de fornecedor viram hash**, nunca são armazenados em claro.
  O hash serve a um propósito único: detectar **troca** de conta entre
  sincronizações — o vetor mais comum de fraude de boleto/PIX no Brasil.
- **CPF de pessoa física é mascarado na exibição** (LGPD, minimização); CNPJ
  sai inteiro.
- **Segregação de função:** `canViewControladoria` (ADMIN, GESTOR,
  CONTROLADORIA) é diferente de `canManageControladoria` (ADMIN,
  CONTROLADORIA). Num módulo que aponta o erro dos outros, "ver" e "poder
  desligar o alerta" não podem ser a mesma permissão.
- **Trilha append-only** (`ControladoriaEventLog`): toda ação humana no módulo
  — tratativa de achado, mudança de parâmetro, meta de BSC, sync e envio manual
  — fica registrada com autor, valores antes/depois, IP e user-agent. Nunca é
  alterada nem apagada.
- **Tratativa exige justificativa:** marcar um achado como resolvido ou "não se
  aplica" exige descrever o que foi verificado. Sem isso, em três meses ninguém
  lembra por que o alerta foi desligado.
- **Cron autenticado com comparação em tempo constante** (`timingSafeEqual`).
- **Relatório servido com CSP restritiva** (`default-src 'none'`), sem cache
  compartilhado, e sempre filtrado por `companyId`.

---

## 8. Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|---|---|---|
| `OMIE_APP_KEY` / `OMIE_APP_SECRET` | Sim | Integração com a Omie. Sem elas o módulo fica inteiro em modo "não configurado" |
| `CRON_SECRET` | Sim | Autentica a rota agendada (já usada pelo cron do TiqueTaque) |
| `RESEND_API_KEY` | Para enviar e-mail | Envio do relatório diário. Sem ela o relatório é gerado e fica disponível no sistema, apenas não é enviado |
| `EMAIL_REMETENTE` | Não | Padrão: `Controladoria Azul Mob <controladoria@azulmob.com.br>`. **O domínio precisa estar verificado no Resend** (SPF/DKIM), senão a mensagem é recusada ou cai em spam |
| `ANTHROPIC_API_KEY` | Não | Leitura executiva por IA. Sem ela o relatório sai completo, sem essa seção |
| `APP_URL` | Não | URL do sistema para o botão do e-mail. Na Vercel, cai para `VERCEL_PROJECT_PRODUCTION_URL` |
| `OMIE_DATA_INICIO_BASE` | Não | Padrão `2025-01-01`. Também editável na tela de configuração |
| `RELATORIO_EMAILS` | Não | Destinatário padrão na primeira execução. Depois, a tela de configuração manda |
| `OMIE_PACE_MS` | Não | Espaçamento entre chamadas à Omie (padrão 350ms) |

---

## 9. O que validar na PRIMEIRA execução real contra a Omie

Esta é a parte honesta: o mapeamento dos campos da Omie foi escrito a partir da
documentação pública, e **a resposta real da conta do cliente pode trazer nomes
de campo diferentes** — a Omie varia nomes entre endpoints e entre versões do
mesmo endpoint, e a documentação não cobre todas as variações.

A leitura é tolerante de propósito (`src/lib/omie/mapping.ts`): um campo que
mude de nome vira `null` e o registro entra com aquele campo vazio, em vez de
derrubar o sync inteiro. E existe uma tela feita justamente para revelar isso:

**Controladoria → Sincronização → "Preenchimento dos campos"** mostra o
percentual preenchido por campo e por entidade. Depois da primeira carga:

1. Se **categoria, centro de custo ou documento** aparecerem com preenchimento
   muito baixo, verifique se é falha de processo na Omie (o campo realmente não
   é preenchido — e aí o agente já abre o achado) ou se é um alias faltando na
   lista de nomes conhecidos do `mapping.ts`.
2. Confira se o **extrato bancário** trouxe lançamentos para todas as contas
   ativas. Sem extrato, o supervisor suspende a conciliação e a projeção de
   caixa — e diz isso no relatório.
3. As **notas fiscais** são sincronizadas em modo best-effort: os parâmetros de
   filtro de data de NF-e/NFS-e variam entre planos do ERP. Uma recusa ali é
   registrada como erro na execução e **não** impede o núcleo financeiro.
4. Confira se o total de **títulos a pagar do mês** bate com o relatório da
   própria Omie. Divergência aponta para um passo de sincronização que não
   cobriu alguma janela.

---

## 10. Modelo de gestão: parâmetros que valem preencher

Vários agentes ficam **parcialmente desligados** enquanto os parâmetros não
existirem — e dizem isso, em vez de inventar um número:

- **Alçada de aprovação** → liga a detecção de fracionamento. O sistema calcula
  uma **sugestão a partir da distribuição real dos pagamentos da empresa**
  (percentis 50/90/99), visível na tela de configuração — melhor que uma tabela
  genérica de mercado, que erra nos dois sentidos.
- **Saldo mínimo de caixa** → liga o alerta antes que a falta de saldo vire
  juros de conta garantida.
- **Meta de margem por contrato** → sem ela, o sistema só aponta margem
  negativa; não arbitra qual margem positiva é "boa".
- **Tolerância de variação, atraso crítico e limite de concentração** → têm
  padrão razoável, mas valem ser ajustados à realidade da operação.

Regra de controle interno que sustenta o resto, independentemente dos valores:
**quem cadastra o título nunca pode ser quem aprova o pagamento.**
