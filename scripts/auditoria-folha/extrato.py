"""Extrator do Extrato Mensal (qualquer empresa/competencia do mesmo sistema
de folha). Reconstroi o holerite por POSICAO das palavras, nao por texto
corrido: o PDF tem duas colunas de rubricas e a leitura linear embaralha
provento com desconto.

Peculiaridades ja descobertas e tratadas:
  - 'Empr.:'  = empregado celetista; 'Contr:' = contribuinte individual
    (socio/diretor com pro-labore), que nao tem 'Horas Mes'.
  - o bloco de cada pessoa termina na linha 'Base INSS:'; rubricas fora de
    um bloco pertencem a totalizacao geral do fim do relatorio e nunca
    podem ser somadas a um funcionario.
  - linhas informativas ('*') trazem o valor na FAIXA DA REFERENCIA.
"""
import re, sys, json, collections
import pymupdf

NUM = re.compile(r'^-?[\d.]*\d,\d{2}$')


def money(s):
    return round(float(s.replace('.', '').replace(',', '.')), 2)


def lines_of(page):
    ws = page.get_text('words')
    ws.sort(key=lambda w: (w[1], w[0]))
    out, cur, cy = [], [], None
    for w in ws:
        if cy is None or abs(w[1] - cy) <= 3:
            cur.append(w)
            cy = w[1] if cy is None else cy
        else:
            out.append(cur)
            cur, cy = [w], w[1]
    if cur:
        out.append(cur)
    return out


def parse_side(toks, left):
    if not toks:
        return None
    toks = sorted(toks, key=lambda w: w[0])
    if not re.fullmatch(r'\d{1,4}', toks[0][4]):
        return None
    ref = val = tipo = None
    desc = []
    refband = (195, 215) if left else (485, 500)
    valband = (255, 280) if left else (535, 555)
    for w in toks[1:]:
        t = w[4]
        if NUM.match(t):
            if refband[0] <= w[2] <= refband[1]:
                ref = money(t)
            elif valband[0] <= w[2] <= valband[1]:
                val = money(t)
            else:
                desc.append(t)
        elif t in ('P', 'D', '*'):
            tipo = t
        else:
            desc.append(t)
    if ref is None and val is None:
        return None
    return {'cod': toks[0][4], 'desc': ' '.join(desc).strip(), 'ref': ref,
            'val': val, 'tipo': tipo or '?'}


def parse(path):
    doc = pymupdf.open(path)
    cab, emps, totais, cur = {}, [], [], None
    for pno, page in enumerate(doc, 1):
        for toks in lines_of(page):
            txt = ' '.join(w[4] for w in sorted(toks, key=lambda w: w[0]))
            if pno == 1:
                m = re.match(r'Cálculo:\s+(.+?)(?:\s+Horas:|$)', txt)
                if m:
                    cab['calculo'] = m.group(1).strip()
                m = re.match(r'Competência:\s+(\S+)', txt)
                if m:
                    cab['competencia'] = m.group(1)
                m = re.match(r'(\d+) - (.+?)\s+Página:', txt)
                if m:
                    cab['empresa_cod'], cab['empresa'] = m.group(1), m.group(2).strip()
                m = re.search(r'CNPJ:\s+([\d./\-]+)', txt)
                if m:
                    cab['cnpj'] = m.group(1)
            if txt.startswith(('Empr.:', 'Contr:')):
                m = re.match(r'(Empr\.|Contr):\s+(\d+)\s+(.+?)\s+Situação:\s+(.+?)\s+CPF:\s+([\d.\-]+)\s+Adm:\s+([\d/]+)', txt)
                if m:
                    cur = {'tipo_pessoa': 'EMPREGADO' if m.group(1) == 'Empr.' else 'CONTRIBUINTE',
                           'mat': m.group(2), 'nome': m.group(3).strip(), 'situacao': m.group(4).strip(),
                           'cpf': re.sub(r'\D', '', m.group(5)), 'adm': m.group(6), 'pag': pno, 'rubricas': []}
                    emps.append(cur)
                continue
            if cur is None and ('Proventos:' in txt or 'Base INSS:' in txt
                                or txt.startswith(('Vínculo:', 'Cargo:'))):
                continue
            if cur is not None and txt.startswith('Vínculo:'):
                m = re.search(r'Vínculo:\s+(\S+).*?CC:\s+(\d+).*?Depto:\s+(\d+)(?:.*?Horas Mês:\s+([\d.,]+))?', txt)
                if m:
                    cur.update(vinculo=m.group(1), cc=m.group(2), depto=m.group(3),
                               horas_mes=money(m.group(4)) if m.group(4) else None)
                continue
            if cur is not None and txt.startswith('Cargo:'):
                m = re.match(r'Cargo:\s+(\d+)\s+(.+?)\s+C\.B\.O:\s+(\d+)\s+Filial:\s+(\d+)\s+Salário:\s+([\d.,]+)', txt)
                if m:
                    cur.update(cargo_cod=m.group(1), cargo=m.group(2).strip(), cbo=m.group(3),
                               filial=m.group(4), salario=money(m.group(5)))
                continue
            if cur is not None and 'Proventos:' in txt:
                g = lambda p: (money(re.search(p, txt).group(1)) if re.search(p, txt) else None)
                cur.update(proventos=g(r'Proventos:\s+([\d.,]+)'),
                           descontos=g(r'Descontos:\s+([\d.,]+)'),
                           liquido=g(r'Líquido:\s+([\d.,]+)'))
                continue
            if cur is not None and 'Base INSS:' in txt:
                g = lambda p: (money(re.search(p, txt).group(1)) if re.search(p, txt) else None)
                cur.update(base_inss=g(r'Base INSS:\s+([\d.,]+)'),
                           base_fgts=g(r'Base FGTS:\s+([\d.,]+)'),
                           valor_fgts=g(r'Valor FGTS:\s+([\d.,]+)'),
                           base_irrf=g(r'Base IRRF:\s+([\d.,]+)'))
                cur = None
                continue
            for left in (True, False):
                r = parse_side([w for w in toks if (w[0] < 295) == left], left)
                if r:
                    (cur['rubricas'] if cur is not None else totais).append(r)
    return cab, emps, totais


if __name__ == '__main__':
    for path in sys.argv[1:]:
        cab, emps, totais = parse(path)
        P = sum(e.get('proventos') or 0 for e in emps)
        D = sum(e.get('descontos') or 0 for e in emps)
        L = sum(e.get('liquido') or 0 for e in emps)
        print('=' * 78)
        print('%s  —  %s %s | %s | competencia %s | calculo: %s'
              % (path, cab.get('empresa_cod'), cab.get('empresa'), cab.get('cnpj'),
                 cab.get('competencia'), cab.get('calculo')))
        print('=' * 78)
        print('pessoas: %d | proventos %.2f | descontos %.2f | liquido %.2f'
              % (len(emps), P, D, L))
        tp = sum(r['val'] or 0 for r in totais if r['tipo'] == 'P')
        td = sum(r['val'] or 0 for r in totais if r['tipo'] == 'D')
        if totais:
            print('totalizacao geral: proventos %.2f | descontos %.2f | liquido %.2f  -> %s'
                  % (tp, td, tp - td, 'FECHA' if abs((tp - td) - L) < 0.02 else 'NAO FECHA'))
        err = [e for e in emps
               if abs(round(sum(r['val'] or 0 for r in e['rubricas'] if r['tipo'] == 'P'), 2) - (e.get('proventos') or 0)) > 0.011
               or abs(round(sum(r['val'] or 0 for r in e['rubricas'] if r['tipo'] == 'D'), 2) - (e.get('descontos') or 0)) > 0.011]
        print('aritmetica (proventos - descontos = liquido): %d de %d divergentes' % (len(err), len(emps)))
        for e in err[:5]:
            print('   ', e['mat'], e['nome'])
        c = collections.Counter(r['desc'] for e in emps for r in e['rubricas'])
        print('rubricas: ' + ', '.join('%s (%d)' % (k, v) for k, v in c.most_common(12)))
        json.dump({'cab': cab, 'emps': emps}, open(path.replace('.pdf', '.json'), 'w'), ensure_ascii=False)
        print()
