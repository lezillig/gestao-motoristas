# Auditoria de folha — protótipo

Analisadores escritos durante a conferência das folhas da Azul (07/2026) e
da MCZ (01 a 08/2026). **São protótipo em Python**, fora da stack do app:
servem para descobrir as regras de conferência contra arquivos reais antes
de portá-las para TypeScript dentro do sistema.

Estão versionados porque o conhecimento embutido neles é caro de redescobrir
— cada peculiaridade abaixo custou uma investigação.

## O que cada um faz

| Arquivo | Entrada | Para que serve |
|---|---|---|
| `extrato.py` | Extrato Mensal (PDF) | Reconstrói holerite por holerite, com todas as rubricas |
| `mcz.py` | planilhas de importação e de líquido (.xls/.xlsx) | Lê e compara versões de um mesmo fechamento |
| `banco.py` | comprovantes do Bradesco (PDF) + planilha de líquido | Confere se cada pessoa recebeu o líquido apurado |

```
python3 extrato.py extrato.pdf              # holerites + fechamento
python3 banco.py comprovantes.pdf liquido.xlsx
```

Dependências: `pymupdf`, `python-calamine`, `xlrd`.

## Peculiaridades descobertas (e por que importam)

**O PDF tem duas colunas de rubricas.** Ler o texto corrido embaralha
provento com desconto. Por isso a extração é por posição das palavras, com
faixas de x para referência e valor.

**`Empr.:` x `Contr:`.** O segundo é contribuinte individual (sócio com
pró-labore) e não tem "Horas Mês". Ignorar esse cabeçalho faz o sócio sumir
da apuração — na Azul eram 3 pessoas e R$ 9.726,00.

**A totalização geral do fim do relatório não pertence a ninguém.** Cada
bloco termina em `Base INSS:`; rubricas fora de um bloco são da totalização.
Sem isso, os totais da empresa inteira são somados ao último funcionário.

**Linhas informativas (`*`) trazem o valor na faixa da referência**, não na
do valor.

**Os códigos de rubrica são por empresa.** Na Azul (164) o 249 é vale-
alimentação; na MCZ (165) é HE 50% do mês anterior. Nunca assumir o código
de uma empresa ao ler a outra.

**A última linha das planilhas de importação é `TOTAL`**, não uma pessoa —
serve de controle, não de lançamento.

**Comprovante bancário casa só por CPF.** O nome vem truncado e o casamento
por prefixo já atribuiu pagamento à pessoa errada.

**Arquivos com nome diferente são importações parciais**, não versões
concorrentes: "Ajuste", "Correção", "Apenas convênio" e "Horas extras"
trazem um subconjunto de rubricas e deixam o resto em branco.
