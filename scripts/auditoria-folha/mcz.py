"""Analisador dos fechamentos da MCZ.

Dois formatos, ambos com cabecalho em linha variavel (por isso detectado, nao
assumido — a MCZ usa linhas diferentes da Azul):

  importacao  'RELACAO DE VALORES PARA FOLHA' — matricula + valor por rubrica,
              com o codigo da rubrica numa linha logo abaixo do nome dela.
              ATENCAO: os codigos NAO batem com os da Azul (empresa 164);
              a MCZ e a empresa 165 e tem seu proprio plano de rubricas.
  liquido     CPF, colaborador, centro de custo, cargo, dados bancarios e o
              liquido a pagar.
"""
import glob, os, re
from python_calamine import CalamineWorkbook


def ler(path):
    wb = CalamineWorkbook.from_path(path)
    nome = wb.sheet_names[0]
    return nome, wb.get_sheet_by_name(nome).to_python()


def txt(v):
    s = "" if v is None else str(v).strip()
    return s[:-2] if s.endswith(".0") and s[:-2].isdigit() else s


def parse_import(path):
    aba, rows = ler(path)
    meta = {"arquivo": os.path.basename(path), "aba": aba}
    hi = None
    for i, r in enumerate(rows[:20]):
        c0 = txt(r[0] if r else "")
        if c0.lower().startswith("tipo de"):
            hi = i
            break
        m = re.match(r"(Codigo Empresa|Razão Social|Inscrição Cnpj|Competencia)", c0, re.I)
        if m:
            meta[m.group(1).lower().split()[0]] = txt(r[2] if len(r) > 2 else "")
    if hi is None:
        raise SystemExit(f"{path}: nao achei a linha de cabecalho 'Tipo de'")
    nomes, cods = rows[hi], rows[hi + 1]
    # coluna -> (codigo da rubrica, nome da rubrica)
    colmap = {}
    for i in range(3, len(cods)):
        cd = txt(cods[i])
        if cd and re.fullmatch(r"\d+", cd):
            colmap[i] = (cd, txt(nomes[i]) if i < len(nomes) else "")
    pessoas, total = {}, {}
    for r in rows[hi + 2:]:
        if not r or not txt(r[1]):
            continue
        if txt(r[0]).upper() == "TOTAL":
            for i, (cd, _) in colmap.items():
                v = r[i] if i < len(r) else None
                if isinstance(v, (int, float)) and v:
                    total[cd] = round(float(v), 2)
            continue
        mat = txt(r[1])
        vals = {}
        for i, (cd, _) in colmap.items():
            v = r[i] if i < len(r) else None
            if isinstance(v, (int, float)) and round(float(v), 2):
                vals[cd] = round(float(v), 2)
        pessoas[mat] = {"nome": txt(r[2]), "vals": vals}
    return {"meta": meta, "rubricas": {c: n for c, n in colmap.values()}, "pessoas": pessoas, "total": total}


def parse_liquido(path):
    aba, rows = ler(path)
    hi = next(i for i, r in enumerate(rows[:10]) if any(txt(c).upper() == "CPF" for c in r))
    cols = [txt(c).lower() for c in rows[hi]]
    ix = {n: cols.index(n) for n in cols if n}
    pessoas, total = {}, None
    for r in rows[hi + 1:]:
        if not r:
            continue
        c0 = txt(r[0])
        if c0.lower().startswith("total"):
            nums = [c for c in r if isinstance(c, (int, float))]
            if nums:
                total = round(float(nums[-1]), 2)
            continue
        nome = txt(r[ix.get("colaborador", 1)])
        if not nome:
            continue
        cpf = re.sub(r"\D", "", txt(r[0]))
        liq = r[ix["liquido"]] if "liquido" in ix and ix["liquido"] < len(r) else None
        if not isinstance(liq, (int, float)):
            nums = [c for c in r if isinstance(c, (int, float))]
            liq = nums[-1] if nums else 0
        pessoas[nome.upper()] = {
            "cpf": cpf.zfill(11) if cpf else "",
            "centro": txt(r[ix.get("centro de custo", 2)]),
            "cargo": txt(r[ix.get("cargo", 3)]),
            "liquido": round(float(liq), 2),
        }
    return {"arquivo": os.path.basename(path), "aba": aba, "pessoas": pessoas, "total": total}


def diff_import(a, b, rot_a, rot_b):
    print(f"\n{'='*86}\nIMPORTACAO: {rot_a}  x  {rot_b}\n{'='*86}")
    pa, pb = a["pessoas"], b["pessoas"]
    so_a, so_b = sorted(set(pa) - set(pb), key=int), sorted(set(pb) - set(pa), key=int)
    if so_a:
        print(f"  so em {rot_a}: " + ", ".join(f"{m} {pa[m]['nome']}" for m in so_a))
    if so_b:
        print(f"  so em {rot_b}: " + ", ".join(f"{m} {pb[m]['nome']}" for m in so_b))
    rub = {**a["rubricas"], **b["rubricas"]}
    mudou = []
    for m in sorted(set(pa) & set(pb), key=int):
        va, vb = pa[m]["vals"], pb[m]["vals"]
        for cd in sorted(set(va) | set(vb)):
            x, y = va.get(cd), vb.get(cd)
            if x != y:
                mudou.append((m, pa[m]["nome"], cd, rub.get(cd, "?"), x, y))
    if not mudou and not so_a and not so_b:
        print("  identicos.")
        return
    if mudou:
        print(f"\n  {len(mudou)} valor(es) alterado(s):")
        print(f"  {'mat':>4} {'colaborador':<32} {'cod':>5} {'rubrica':<26} {rot_a:>12} {rot_b:>12}")
        for m, nm, cd, rn, x, y in mudou:
            print(f"  {m:>4} {nm[:32]:<32} {cd:>5} {rn[:26]:<26} {('—' if x is None else f'{x:.2f}'):>12} {('—' if y is None else f'{y:.2f}'):>12}")


def diff_liquido(a, b, rot_a, rot_b):
    print(f"\n{'='*86}\nLIQUIDO: {rot_a}  x  {rot_b}\n{'='*86}")
    pa, pb = a["pessoas"], b["pessoas"]
    print(f"  {rot_a}: {len(pa)} pessoas, total {a['total'] if a['total'] is not None else sum(p['liquido'] for p in pa.values()):.2f}")
    print(f"  {rot_b}: {len(pb)} pessoas, total {b['total'] if b['total'] is not None else sum(p['liquido'] for p in pb.values()):.2f}")
    for nome in sorted(set(pb) - set(pa)):
        print(f"    so em {rot_b}: {nome} — {pb[nome]['liquido']:.2f}")
    for nome in sorted(set(pa) - set(pb)):
        print(f"    so em {rot_a}: {nome} — {pa[nome]['liquido']:.2f}")
    for nome in sorted(set(pa) & set(pb)):
        if abs(pa[nome]["liquido"] - pb[nome]["liquido"]) > 0.005:
            print(f"    {nome:<34} {pa[nome]['liquido']:>10.2f} -> {pb[nome]['liquido']:>10.2f}  ({pb[nome]['liquido']-pa[nome]['liquido']:+.2f})")


if __name__ == "__main__":
    imps = {p: parse_import(p) for p in sorted(glob.glob("imp_*.xls"))}
    liqs = {p: parse_liquido(p) for p in sorted(glob.glob("liq_*.xlsx"))}

    print("=" * 86)
    print("ARQUIVOS DE IMPORTACAO (MCZ)")
    print("=" * 86)
    print(f"{'arquivo':<20} {'aba':<12} {'competencia':<12} {'pessoas':>8} {'rubricas usadas':>16}")
    for p, d in imps.items():
        usadas = len({c for pe in d["pessoas"].values() for c in pe["vals"]})
        print(f"{d['meta']['arquivo'][:20]:<20} {d['meta']['aba']:<12} {d['meta'].get('competencia','?'):<12} {len(d['pessoas']):>8} {usadas:>16}")

    print()
    print("=" * 86)
    print("ARQUIVOS DE LIQUIDO (MCZ)")
    print("=" * 86)
    print(f"{'arquivo':<40} {'aba':<14} {'pessoas':>8} {'total':>12}")
    for p, d in liqs.items():
        t = d["total"] if d["total"] is not None else sum(x["liquido"] for x in d["pessoas"].values())
        print(f"{d['arquivo'][:40]:<40} {d['aba']:<14} {len(d['pessoas']):>8} {t:>12.2f}")
