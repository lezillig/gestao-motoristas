# Departamento de RH e DP — agentes especializados

Time de agentes para conferência, auditoria e análise de folha num grupo de
**transporte de pessoas** (fretamento, escolar, corporativo), com duas
empresas de plano de rubricas próprio: **Azul Transportes** (164) e
**MCZ Transportes** (165).

Foram escritos a partir de conferências reais — folha 07/2026 da Azul e
01 a 08/2026 da MCZ. As armadilhas citadas em cada um não são hipóteses:
cada uma custou uma investigação.

## Quem faz o quê

| Agente | Responde por |
|---|---|
| `dp-gestor` | Coordena um fechamento inteiro, aciona os demais e consolida o parecer |
| `folha-conferencia` | Importação × holerite × líquido × banco, e a aritmética de cada holerite |
| `ponto-jornada` | Horas extras e jornada do ponto contra o que a folha pagou |
| `cct-clt` | Piso, reajuste, adicionais e cláusulas — CLT e convenção coletiva |
| `beneficios` | VR, VA, VT, saúde, odonto, seguro de vida |
| `encargos-tributos` | FGTS, INSS, IRRF e as guias recolhidas |
| `admissao-rescisao` | TRCT, aviso prévio, férias, 13º, prazos |
| `rh-cadastro` | CPF, CBO, cargo, sindicato, enquadramento |
| `passivo-trabalhista` | Quantificação de risco e ordem de correção |
| `controles-internos` | O processo: quem lança, confere e aprova |
| `analise-dados` | Séries entre competências, outliers, custo de mão de obra |
| `auditor-revisor` | Revisa o parecer, não a folha: refaz o caminho de cada achado |

## Como usar

Para um fechamento inteiro, chame o **`dp-gestor`**: ele inventaria o que
chegou, aciona os especialistas certos e devolve um parecer único
classificado por severidade.

Para pergunta pontual, vá direto ao especialista — é mais rápido e mais
barato.

Antes de mandar um parecer para fora — contador, advogado, sindicato —
passe o **`auditor-revisor`**. Ele não confere a folha; confere a
conferência, e classifica cada achado em confirmado, frágil, derrubado ou
incompleto. Numa auditoria real deste grupo, essa segunda passagem derrubou
quatro achados e corrigiu o valor de outros três.

## Princípios comuns

Três regras valem para todos, e existem porque o custo de errar aqui é alto:

**Nunca afirmar sem prova.** "Está errado" exige demonstração: um fator
exato, uma diferença que fecha, uma regra citada. Sem isso, o texto é
"não consigo decidir com o que tenho — preciso de X".

**Distinguir o que não fecha do que está errado.** Rescisão com líquido zero
não é erro. FGTS acima de 8% da base mensal numa rescisão é esperado.
Sazonalidade do transporte escolar não é anomalia.

**Casar sempre por CPF.** Nome vem truncado em quase toda fonte — 34
caracteres no Extrato Mensal, ~30 no comprovante bancário — e casar por
prefixo já atribuiu pagamento à pessoa errada.

## Ferramentas

- `scripts/auditoria-folha/` — analisadores de Extrato Mensal (PDF),
  planilhas de importação e líquido, e comprovantes bancários
- `scripts/tiquetaque-export.mjs` — extração de ponto, afastamentos e
  espelho apurado
- `src/lib/convencao.ts` — resolução de regra CLT/CCT/ACT já implementada
- `src/lib/passivoTrabalhista.ts`, `src/lib/pontoCompliance.ts`,
  `src/lib/jurisprudencia.ts` — critérios já em uso no sistema
