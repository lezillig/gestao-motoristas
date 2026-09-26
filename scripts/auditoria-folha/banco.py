"""Extrai os comprovantes de credito em conta salario (Bradesco Multipag) —
um por pagina — e cruza com a planilha de liquido da competencia.

Confere tres coisas que so o banco prova: se cada pessoa da folha recebeu,
se o VALOR pago e o liquido apurado, e se nao houve pagamento a quem nao
esta na folha.
"""
import re, sys, unicodedata
import pymupdf
import mcz


def limpa(s):
    s = unicodedata.normalize("NFKD", s.upper())
    return "".join(c for c in s if not unicodedata.combining(c)).strip()


def parse_comprovantes(path):
    doc = pymupdf.open(path)
    out = []
    for pno, page in enumerate(doc, 1):
        t = page.get_text()
        # o nome vem truncado no comprovante (cabe ~30 caracteres), entao o
        # casamento com a folha e por CPF quando ha, e por prefixo de nome
        # quando o CPF falta.
        nome = re.search(r"Funcion[áa]rio:\s*(.+?)\s*CPF:", t, re.S)
        cpf = re.search(r"CPF:\s*([\d.\-]+)", t)
        val = re.search(r"Valor\s*\(R\$\):\s*([\d.]+,\d{2})", t, re.S)
        data = re.search(r"Data\s*de\s*Pagamento:\s*([\d/]{10})", t, re.S)
        conta = re.search(r"Conta:\s*([\d\-]+)\s*$", t, re.M)
        if not val:
            continue
        out.append({
            "pag": pno,
            "nome": limpa(re.sub(r"\s+", " ", nome.group(1))) if nome else "",
            "cpf": re.sub(r"\D", "", cpf.group(1)) if cpf else "",
            "valor": round(float(val.group(1).replace(".", "").replace(",", ".")), 2),
            "data": data.group(1) if data else "",
            "conta": conta.group(1) if conta else "",
        })
    return out


if __name__ == "__main__":
    pdf, xlsx = sys.argv[1], sys.argv[2]
    comps = parse_comprovantes(pdf)
    liq = mcz.parse_liquido(xlsx)

    total_c = round(sum(c["valor"] for c in comps), 2)
    total_l = liq["total"] if liq["total"] is not None else round(sum(p["liquido"] for p in liq["pessoas"].values()), 2)
    datas = sorted({c["data"] for c in comps})

    print("=" * 84)
    print("COMPROVANTES BANCARIOS x PLANILHA DE LIQUIDO")
    print("=" * 84)
    print(f"  comprovantes: {len(comps)} · total {total_c:,.2f} · data(s) {', '.join(datas)}")
    print(f"  planilha    : {len(liq['pessoas'])} pessoas · total {total_l:,.2f}")
    print(f"  diferenca   : {total_c - total_l:+,.2f}")

    # indice da folha por CPF e por prefixo de nome
    por_cpf = {p["cpf"]: (n, p) for n, p in liq["pessoas"].items() if p["cpf"]}
    por_nome = {limpa(n): (n, p) for n, p in liq["pessoas"].items()}

    casados, sem_folha = {}, []
    for c in comps:
        # casamento SO por CPF. O nome no comprovante vem truncado e o
        # casamento por prefixo ja atribuiu comprovante a pessoa errada —
        # dois colaboradores com o mesmo primeiro nome recebiam o mesmo
        # pagamento. Sem CPF na folha, exige nome normalizado identico.
        alvo = por_cpf.get(c["cpf"])
        if alvo is None:
            alvo = por_nome.get(c["nome"])
        if alvo is None:
            sem_folha.append(c)
        else:
            casados.setdefault(alvo[0], []).append(c)

    print("\n-- pagamentos sem correspondencia na folha --")
    print("   " + ("nenhum" if not sem_folha else ""))
    for c in sem_folha:
        print(f"   pag {c['pag']:>3}  {c['nome'][:36]:<36} CPF {c['cpf']:<11} {c['valor']:>10,.2f}")

    print("\n-- pessoas da folha sem comprovante --")
    faltam = [n for n in liq["pessoas"] if n not in casados]
    print("   " + ("nenhuma" if not faltam else ""))
    for n in faltam:
        print(f"   {n[:36]:<36} liquido {liq['pessoas'][n]['liquido']:>10,.2f}  ({liq['pessoas'][n]['cargo']})")

    print("\n-- valor pago diferente do liquido apurado --")
    difs = []
    for n, cs in casados.items():
        pago = round(sum(x["valor"] for x in cs), 2)
        dev = liq["pessoas"][n]["liquido"]
        if abs(pago - dev) > 0.005:
            difs.append((n, dev, pago, len(cs)))
    print("   " + ("nenhum" if not difs else ""))
    for n, dev, pago, k in sorted(difs, key=lambda x: -abs(x[2] - x[1])):
        extra = f"  ({k} comprovantes)" if k > 1 else ""
        print(f"   {n[:36]:<36} folha {dev:>10,.2f}  banco {pago:>10,.2f}  {pago - dev:>+10,.2f}{extra}")
