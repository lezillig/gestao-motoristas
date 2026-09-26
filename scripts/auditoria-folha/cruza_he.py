"""Cruza as horas extras APONTADAS na folha (arquivos de importacao) com as
horas APURADAS no ponto (espelho mensal do TiqueTaque).

O casamento e por nome normalizado: os arquivos de importacao trazem
matricula e nome, sem CPF; o TiqueTaque traz nome com acento. Normaliza os
dois (sem acento, maiusculas, espacos colapsados) antes de comparar.
"""
import csv, glob, re, sys, unicodedata, collections
import mcz

# rubrica no arquivo de importacao -> coluna do espelho do TiqueTaque
PARES = [("150", "extra_50", "HE 50%"),
         ("200", "extra_100", "HE 100%"),
         ("25", "adicional_noturno", "Ad. noturno")]
TOL = 0.02


def norm(s):
    s = unicodedata.normalize("NFKD", (s or "").upper())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip()


def le_espelho(path):
    """(nome_normalizado, competencia) -> {coluna: horas}"""
    out = {}
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f, delimiter=";"):
            out[(norm(r["nome"]), r["competencia"])] = {
                k: float(r[k] or 0) for k in ("extra_50", "extra_100", "adicional_noturno")
            }
    return out


def competencia_de(imp):
    c = imp["meta"].get("competencia", "")
    return c[:7] if re.match(r"\d{4}-\d{2}", c) else c


def compara(arquivo, espelho, rotulo=None):
    imp = mcz.parse_import(arquivo)
    comp = competencia_de(imp)
    rot = rotulo or arquivo
    linhas, sem_ponto = [], []
    for mat, p in imp["pessoas"].items():
        chave = (norm(p["nome"]), comp)
        esp = espelho.get(chave)
        for cod, col, nome_rub in PARES:
            apontado = p["vals"].get(cod)
            if apontado is None and esp is None:
                continue
            if esp is None:
                if apontado:
                    sem_ponto.append((mat, p["nome"], nome_rub, apontado))
                continue
            real = esp[col]
            if apontado is None and not real:
                continue
            a = apontado or 0
            if abs(a - real) > TOL:
                linhas.append((mat, p["nome"], nome_rub, a, real, a - real))
    return comp, rot, linhas, sem_ponto, len(imp["pessoas"])


if __name__ == "__main__":
    espelho = le_espelho(sys.argv[1] if len(sys.argv) > 1 else "../tt-mcz/espelho_mensal.csv")
    print("espelho carregado: %d pares (pessoa, competencia)\n" % len(espelho))

    arquivos = sorted(glob.glob("imp_*.xls"))
    print("=" * 96)
    print("HORAS APONTADAS NA FOLHA  x  HORAS APURADAS NO PONTO (TiqueTaque)")
    print("=" * 96)
    print("%-22s %-9s %8s %10s %12s %14s" % ("arquivo", "compet.", "pessoas", "divergem", "sem espelho", "horas de dif."))
    resumo = {}
    for a in arquivos:
        comp, rot, linhas, sem, n = compara(a, espelho)
        dif = sum(abs(x[5]) for x in linhas)
        resumo[a] = (comp, linhas, sem, n)
        print("%-22s %-9s %8d %10d %12d %14.2f" % (a, comp, n, len({(x[0], x[2]) for x in linhas}), len(sem), dif))

    for a in arquivos:
        comp, linhas, sem, n = resumo[a]
        if not linhas:
            continue
        print("\n" + "-" * 96)
        print("%s  (competencia %s)" % (a, comp))
        print("-" * 96)
        print("  %-4s %-32s %-12s %10s %10s %10s" % ("mat", "colaborador", "rubrica", "folha", "ponto", "dif"))
        for mat, nome, rub, ap, real, d in sorted(linhas, key=lambda x: -abs(x[5]))[:25]:
            print("  %-4s %-32s %-12s %10.2f %10.2f %+10.2f" % (mat, nome[:32], rub, ap, real, d))
        if len(linhas) > 25:
            print("  ... e mais %d" % (len(linhas) - 25))
