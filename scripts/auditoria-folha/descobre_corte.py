"""Descobre o DIA DE CORTE do periodo de apuracao do ponto.

A API do TiqueTaque nao expoe o periodo de fechamento (nao ha endpoint de
work-schedules), mas /timesheets aceita qualquer intervalo. Entao pedimos o
espelho em varias janelas candidatas e medimos qual delas melhor explica as
horas que a folha pagou.

Janela candidata para a competencia C, com corte no dia D:
    de (D+1) do mes C-2  ate  D do mes C-1
Com D = ultimo dia, isso vira o mes calendario C-1 — a hipotese que estava
em uso ate agora.

Roda sobre uma AMOSTRA das pessoas com mais hora extra: o objetivo e
comparar hipoteses, nao auditar, e assim o teste custa minutos em vez de
horas.
"""
import csv, glob, json, re, subprocess, sys, time, calendar, collections
import mcz
import cruza_he as X

BASE = "https://api.tiquetaque.com/v2.1"
CACERT = "/root/.ccr/ca-bundle.crt"
PACE = 1.1
CORTES = [15, 20, 25, 0]          # 0 = ultimo dia do mes (mes calendario)
AMOSTRA = 14


def api(path):
    r = subprocess.run(["curl", "-sS", "--cacert", CACERT, f"{BASE}{path}"],
                       capture_output=True, text=True, timeout=90)
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return {}


def menos_um(comp, n=1):
    a, m = int(comp[:4]), int(comp[5:7])
    for _ in range(n):
        m -= 1
        if m == 0:
            a, m = a - 1, 12
    return a, m


def janela(comp, corte):
    """(inicio, fim) da janela de apuracao que a competencia `comp` paga."""
    a1, m1 = menos_um(comp, 1)
    if corte == 0:
        return f"{a1:04d}-{m1:02d}-01", f"{a1:04d}-{m1:02d}-{calendar.monthrange(a1, m1)[1]:02d}"
    a2, m2 = menos_um(comp, 2)
    d2 = min(corte, calendar.monthrange(a2, m2)[1])
    d1 = min(corte, calendar.monthrange(a1, m1)[1])
    ini = f"{a2:04d}-{m2:02d}-{d2 + 1:02d}" if d2 + 1 <= calendar.monthrange(a2, m2)[1] else f"{a1:04d}-{m1:02d}-01"
    return ini, f"{a1:04d}-{m1:02d}-{d1:02d}"


def main():
    # quem mais tem HE na folha — a amostra que melhor discrimina as hipoteses
    horas = collections.Counter()
    folha = {}
    for arq in sorted(glob.glob("imp_*.xls")):
        d = mcz.parse_import(arq)
        comp = d["meta"].get("competencia", "")[:7]
        us = {k for p in d["pessoas"].values() for k in p["vals"]}
        if not ({"150", "200"} & us) or not re.match(r"\d{4}-\d{2}", comp):
            continue
        if arq == "imp_06.xls":       # o original de junho e sabidamente errado
            continue
        for p in d["pessoas"].values():
            h = (p["vals"].get("150", 0) or 0) + (p["vals"].get("200", 0) or 0)
            horas[X.norm(p["nome"])] += h
            folha.setdefault(X.norm(p["nome"]), {})[comp] = h

    ids = {}
    with open("../tt-mcz/funcionarios.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f, delimiter=";"):
            ids[X.norm(r["nome"])] = r["employee_id"]

    amostra = [n for n, _ in horas.most_common() if n in ids][:AMOSTRA]
    comps = sorted({c for v in folha.values() for c in v})
    print(f"amostra: {len(amostra)} pessoas · {len(comps)} competencias")
    print(f"chamadas por hipotese: {len(amostra) * len(comps)}\n")

    resultado = {}
    for corte in CORTES:
        rot = "mes calendario" if corte == 0 else f"corte dia {corte}"
        erro = 0.0
        t0 = time.time()
        for nome in amostra:
            for comp in comps:
                if comp not in folha[nome]:
                    continue
                ini, fim = janela(comp, corte)
                d = api(f"/timesheets?employee_id={ids[nome]}&start_date={ini}&end_date={fim}")
                t = d.get("totals") or {}
                num = lambda k: float(str(t.get(k, 0) or 0) or 0)
                real = num("extra_50") + num("extra_100")
                erro += abs(folha[nome][comp] - real)
                time.sleep(PACE)
        resultado[rot] = erro
        print(f"  {rot:<18} erro total {erro:9.2f} h   ({time.time() - t0:.0f}s)")

    melhor = min(resultado, key=resultado.get)
    print(f"\nMELHOR AJUSTE: {melhor}  ({resultado[melhor]:.2f} h de erro)")
    pior = max(resultado, key=resultado.get)
    print(f"pior: {pior} ({resultado[pior]:.2f} h) — diferenca de {resultado[pior] - resultado[melhor]:.2f} h entre as hipoteses")


if __name__ == "__main__":
    main()
