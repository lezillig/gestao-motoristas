"""Descobre a JANELA DE APURACAO da folha e confere a hora extra contra ela.

Por que existe
--------------
A folha nao fecha no mes civil, e a API do TiqueTaque nao expoe o periodo de
fechamento. Mas o espelho diario (/timesheets, coluna a coluna por dia) aceita
qualquer recorte — entao da para procurar a janela por forca bruta: aquela que
reproduz a hora extra que a folha pagou.

O criterio nao e "erro pequeno", e "acerta todo mundo". Na Azul, a janela certa
de 08/2026 (10/07 a 09/08) acerta 263 de 263 pessoas com erro total de 1,54 h; a
segunda melhor erra 1.052 h. Quando a janela esta certa, a separacao e brutal —
se o melhor candidato nao se destaca, a janela nao foi encontrada.

Tres armadilhas que ja custaram conclusoes erradas
--------------------------------------------------
1. A competencia de TRANSICAO tem janela mais curta. Em 01/2026 a janela tem 25
   dias (16/12 a 09/01), nao 30: o trecho de 10 a 15/12 saiu na folha anterior.
   Por isso a busca varre a duracao, nao so o dia de inicio.
2. A hora extra pode estar em arquivo de importacao SEPARADO. Em 07/2026 o
   arquivo principal traz zero HE — ela toda esta no complementar. Conferir so o
   principal produz centenas de falsas divergencias.
3. Um arquivo complementar pode SUBSTITUIR em vez de somar. Compare valor a
   valor: se as mesmas pessoas aparecem com o mesmo numero nos dois, e reenvio.

Uso
---
    python3 janela.py --espelho DIR --imp "imp_08.xls" --comp 2026-08
    python3 janela.py --espelho DIR --imp "imp_07.xls,imp_07_he.xls" --comp 2026-07 \
                      --de 2026-06-01 --ate 2026-07-20
"""
import argparse, collections, csv, datetime, os, re, sys, unicodedata

import mcz

# Rubricas de hora extra nos arquivos de importacao.
RUBRICAS_HE = ("150", "200")
# Diferenca em horas abaixo da qual a pessoa "confere" (arredondamento da folha).
TOL = 0.05


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "").upper())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip()


def ler_espelho(diretorio):
    """{nome normalizado: {data: horas extras do dia}} a partir do espelho diario."""
    caminho = os.path.join(diretorio, "espelho_diario.csv")
    por_pessoa = collections.defaultdict(dict)
    with open(caminho, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f, delimiter=";"):
            he = float(r["extra_50"] or 0) + float(r["extra_100"] or 0)
            por_pessoa[norm(r["nome"])][r["data"]] = he
    return por_pessoa


def ler_folha(arquivos):
    """{nome normalizado: horas extras}. Soma os arquivos passados — confira
    antes se o complementar soma ou substitui (ver armadilha 3)."""
    folha = collections.defaultdict(float)
    for a in arquivos:
        for p in mcz.parse_import(a)["pessoas"].values():
            folha[norm(p["nome"])] += sum(p["vals"].get(r, 0) or 0 for r in RUBRICAS_HE)
    return folha


def avalia(folha, espelho, nomes, ini, fim):
    """(erro total em horas, quantas pessoas conferem) para uma janela."""
    erro = exatos = 0.0
    for n in nomes:
        real = sum(h for d, h in espelho[n].items() if ini <= d <= fim)
        dif = abs(folha[n] - real)
        erro += dif
        if dif <= TOL:
            exatos += 1
    return round(erro, 2), int(exatos)


def busca(folha, espelho, nomes, de, ate, duracoes):
    d0, d1 = datetime.date.fromisoformat(de), datetime.date.fromisoformat(ate)
    saida = []
    for salto in range((d1 - d0).days + 1):
        ini = d0 + datetime.timedelta(days=salto)
        for dur in duracoes:
            fim = ini + datetime.timedelta(days=dur - 1)
            if fim > d1:
                continue
            erro, exatos = avalia(folha, espelho, nomes, ini.isoformat(), fim.isoformat())
            saida.append((erro, -exatos, ini.isoformat(), fim.isoformat(), dur))
    saida.sort()
    return saida


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--espelho", required=True, help="diretorio da extracao (com espelho_diario.csv)")
    ap.add_argument("--imp", required=True, help="arquivos de importacao da competencia, separados por virgula")
    ap.add_argument("--comp", required=True, help="competencia AAAA-MM")
    ap.add_argument("--de", help="inicio da busca (padrao: dia 1 do mes anterior)")
    ap.add_argument("--ate", help="fim da busca (padrao: dia 20 da competencia)")
    ap.add_argument("--duracoes", default="20-40", help="faixa de duracao em dias, ex. 20-40 ou 25,30,31")
    ap.add_argument("--top", type=int, default=6)
    args = ap.parse_args()

    ano, mes = int(args.comp[:4]), int(args.comp[5:7])
    ant_a, ant_m = (ano - 1, 12) if mes == 1 else (ano, mes - 1)
    de = args.de or f"{ant_a:04d}-{ant_m:02d}-01"
    ate = args.ate or f"{ano:04d}-{mes:02d}-20"

    if "-" in args.duracoes:
        a, b = args.duracoes.split("-")
        duracoes = list(range(int(a), int(b) + 1))
        rotulo = f"{a} a {b} dias"
    else:
        duracoes = [int(x) for x in args.duracoes.split(",")]
        rotulo = ", ".join(str(d) for d in duracoes) + " dias"

    espelho = ler_espelho(args.espelho)
    folha = ler_folha([a.strip() for a in args.imp.split(",")])
    nomes = [n for n in folha if n in espelho]
    if not nomes:
        sys.exit("Nenhum nome em comum entre a folha e o espelho — confira os arquivos.")

    print(f"competencia {args.comp} · {len(folha)} na folha · {len(nomes)} tambem no espelho")
    print(f"busca de {de} a {ate}, duracoes de {rotulo}\n")

    res = busca(folha, espelho, nomes, de, ate, duracoes)
    print(f"{'janela':<26}{'dias':>5}{'erro (h)':>11}{'conferem':>12}")
    print("-" * 54)
    for erro, neg, ini, fim, dur in res[:args.top]:
        print(f"{ini} a {fim}{dur:>5}{erro:>11.2f}{-neg:>7}/{len(nomes)}")

    erro, neg, ini, fim, dur = res[0]
    seg = res[1][0] if len(res) > 1 else float("inf")
    print(f"\nMELHOR: {ini} a {fim} ({dur} dias) — {-neg} de {len(nomes)} conferem")
    if seg < erro * 4:
        print("ATENCAO: o segundo candidato erra quase o mesmo. Quando a janela esta\n"
              "certa a separacao e grande; aqui ela nao apareceu. Verifique se a hora\n"
              "extra desta competencia esta toda nos arquivos passados em --imp.")


if __name__ == "__main__":
    main()
