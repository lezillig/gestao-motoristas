"""Testa as DUAS janelas de apuracao reais do TiqueTaque contra o que a
folha pagou, para descobrir qual delas vale para a MCZ e com que defasagem.

O painel do TiqueTaque mostra duas series de periodo convivendo:
    A) 16 de um mes a 15 do seguinte
    B) 10 de um mes a 09 do seguinte
Nenhuma e mes calendario — que foi a hipotese usada ate aqui e esta incluida
como linha de base.

Para cada hipotese, mede o erro total |horas pagas - horas apuradas| sobre
uma amostra das pessoas com mais hora extra.
"""
import calendar, csv, glob, json, re, subprocess, time, collections
import mcz
import cruza_he as X

BASE = "https://api.tiquetaque.com/v2.1"
CACERT = "/root/.ccr/ca-bundle.crt"
PACE = 1.1
AMOSTRA = 12

# (rotulo, dia_inicio, dia_fim, defasagem em meses do FIM ate a competencia)
HIPOTESES = [
    ("16 a 15 · fim no mes anterior", 16, 15, 1),
    ("16 a 15 · fim no proprio mes",  16, 15, 0),
    ("10 a 09 · fim no mes anterior", 10,  9, 1),
    ("10 a 09 · fim no proprio mes",  10,  9, 0),
    ("mes calendario anterior",        1,  0, 1),
]


def api(path):
    r = subprocess.run(["curl", "-sS", "--cacert", CACERT, f"{BASE}{path}"],
                       capture_output=True, text=True, timeout=90)
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return {}


def desloca(ano, mes, n):
    mes -= n
    while mes <= 0:
        mes += 12
        ano -= 1
    return ano, mes


def janela(comp, d_ini, d_fim, lag):
    """Intervalo de apuracao que a competencia `comp` paga, nessa hipotese."""
    a, m = int(comp[:4]), int(comp[5:7])
    af, mf = desloca(a, m, lag)
    if d_fim == 0:                       # mes calendario
        return f"{af:04d}-{mf:02d}-01", f"{af:04d}-{mf:02d}-{calendar.monthrange(af, mf)[1]:02d}"
    ai, mi = desloca(af, mf, 1)
    return (f"{ai:04d}-{mi:02d}-{d_ini:02d}", f"{af:04d}-{mf:02d}-{d_fim:02d}")


def main():
    horas, folha = collections.Counter(), {}
    for arq in sorted(glob.glob("imp_*.xls")):
        d = mcz.parse_import(arq)
        comp = d["meta"].get("competencia", "")[:7]
        us = {k for p in d["pessoas"].values() for k in p["vals"]}
        if not ({"150", "200"} & us) or not re.match(r"\d{4}-\d{2}", comp) or arq == "imp_06.xls":
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
    print(f"amostra {len(amostra)} pessoas x {len(comps)} competencias = "
          f"{len(amostra) * len(comps)} chamadas por hipotese\n")

    cache, placar = {}, {}
    for rot, di, df, lag in HIPOTESES:
        erro, n = 0.0, 0
        t0 = time.time()
        for nome in amostra:
            for comp in comps:
                if comp not in folha[nome]:
                    continue
                ini, fim = janela(comp, di, df, lag)
                ch = (ids[nome], ini, fim)
                if ch not in cache:
                    d = api(f"/timesheets?employee_id={ids[nome]}&start_date={ini}&end_date={fim}")
                    t = d.get("totals") or {}
                    num = lambda k: float(str(t.get(k, 0) or 0) or 0)
                    cache[ch] = num("extra_50") + num("extra_100")
                    time.sleep(PACE)
                erro += abs(folha[nome][comp] - cache[ch]); n += 1
        placar[rot] = erro
        print(f"  {rot:<32} erro {erro:9.2f} h   media {erro / n:6.2f} h/lancamento   ({time.time() - t0:.0f}s)")

    ordem = sorted(placar.items(), key=lambda kv: kv[1])
    print(f"\nMELHOR: {ordem[0][0]}  ({ordem[0][1]:.2f} h)")
    print(f"PIOR:   {ordem[-1][0]}  ({ordem[-1][1]:.2f} h)")
    base = placar["mes calendario anterior"]
    print(f"\nGanho sobre a hipotese usada ate agora (mes calendario): "
          f"{base - ordem[0][1]:.2f} h ({(base - ordem[0][1]) / base * 100:.0f}%)")


if __name__ == "__main__":
    main()
