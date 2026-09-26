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
| `janela.py` | espelho diário do TiqueTaque + planilhas de importação | Descobre a janela de apuração da competência e confere a HE contra ela |

```
python3 extrato.py extrato.pdf              # holerites + fechamento
python3 banco.py comprovantes.pdf liquido.xlsx
python3 janela.py --espelho ../../export-tiquetaque --imp imp_08.xls --comp 2026-08
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

**Mas nem toda parcial soma — algumas substituem.** Na Azul, o
`imp_01_ajuste_conv.xls` repete o principal valor a valor (173 de 173 pessoas
na rubrica 259, 146 de 146 na 246); é reenvio. Já o `imp_01_ajuste_horas.xls`
corrige a hora de 53 das 139 pessoas: é a versão que vale. Compare valor a
valor antes de decidir; somar um reenvio dobra a competência inteira.

**A folha não fecha no mês civil.** Na Azul a janela vai do dia 10 ao dia 09 do
mês seguinte. Comparar de 01 a 30 inflou a divergência da MCZ em 44% (517 h
contra 261 h reais). O `janela.py` descobre a janela por força bruta contra o
espelho diário.

**A competência de transição tem janela mais curta.** Em 01/2026 são 25 dias
(16/12 a 09/01), porque o trecho de 10 a 15/12 saiu na folha anterior. Buscar
só o dia de início, com duração fixa em 30, não encontra.

**A hora extra pode estar inteira num arquivo complementar.** Em 07/2026 o
`imp_07.xls` traz zero HE. Conferir só o principal produziu 164 falsas
divergências e 7.660 h fantasmas.

**O espelho do TiqueTaque (`/timesheets`) já é o ajustado.** Conferido batida a
batida em 50.835 dias-pessoa: entram as aprovadas e os ajustes manuais
aprovados; ficam de fora as solicitações pendentes (todas as 143), as
reprovadas e as desconsideradas pelo gestor. Não há campo dizendo isso na
resposta da API — é preciso cruzar `/times` com a coluna `horarios` do espelho
para confirmar.

**Duas extrações simultâneas no mesmo diretório duplicam em silêncio.** Os CSV
são gravados com append; dois processos intercalam linhas sem erro no log. Uma
pessoa saiu com o histórico dobrado e a folha pareceu pagar exatamente metade
das horas. O `tiquetaque-export.mjs` passou a travar o diretório por PID.
