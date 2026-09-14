"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cardClass } from "@/lib/ui";

export type PontoEvolucao = { dia: string; total: number; alta: number; media: number; baixa: number };
export type VariacaoItem = { chave: string; titulo: string; antes: number; agora: number };

// Cores das gravidades, da mesma familia dos selos desta pagina e validadas
// pro fundo branco com o validador de paleta: "baixa" em azul porque cinza
// nao se distingue como serie. O ambar fica abaixo de 3:1 de contraste, entao
// a identidade nunca depende so da cor — legenda, rotulo na ponta da linha e
// tabela dos dados.
const SERIES = [
  { chave: "alta", label: "Alta", cor: "#d03b3b" },
  { chave: "media", label: "Média", cor: "#e8900c" },
  { chave: "baixa", label: "Baixa", cor: "#4f7cc4" },
] as const;

const ALTURA = 220;
const MARGEM = { top: 14, right: 84, bottom: 28, left: 44 };
const GRADE = "#e2e8f0";
const EIXO = "#cbd5e1";

const fmt = (n: number) => n.toLocaleString("pt-BR");

function diaCurto(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function diaLongo(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Passo "redondo" (1, 2, 2,5, 5 x 10^k) pra 4 intervalos no eixo Y.
function passoBonito(maximo: number): number {
  const bruto = Math.max(1, maximo) / 4;
  const exp = 10 ** Math.floor(Math.log10(bruto));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * exp >= bruto) return Math.max(1, Math.ceil(f * exp));
  return Math.ceil(10 * exp);
}

export default function EvolucaoAuditoria({
  pontos,
  variacao,
  baseDia,
}: {
  pontos: PontoEvolucao[];
  variacao: VariacaoItem[];
  baseDia: string | null;
}) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);
  const [foco, setFoco] = useState<number | null>(null);

  useEffect(() => {
    const el = caixaRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => setLargura(Math.round(entries[0].contentRect.width)));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const atual = pontos.at(-1);
  const base = baseDia ? pontos.find((p) => p.dia === baseDia) : undefined;
  const delta = atual && base ? atual.total - base.total : null;
  const temGrafico = pontos.length >= 2;

  const larguraInterna = Math.max(10, largura - MARGEM.left - MARGEM.right);
  const alturaInterna = ALTURA - MARGEM.top - MARGEM.bottom;
  const passo = passoBonito(Math.max(0, ...pontos.flatMap((p) => [p.alta, p.media, p.baixa])));
  const topo = passo * 4;
  const x = (i: number) => MARGEM.left + (pontos.length <= 1 ? larguraInterna / 2 : (i * larguraInterna) / (pontos.length - 1));
  const y = (v: number) => MARGEM.top + alturaInterna - (v / topo) * alturaInterna;

  // Rotulo na ponta de cada linha — some se as pontas estiverem proximas
  // demais (a legenda e o tooltip continuam identificando as series).
  const pontas = atual ? SERIES.map((s) => ({ ...s, valor: atual[s.chave], py: y(atual[s.chave]) })) : [];
  const pontasOrdenadas = [...pontas].sort((a, b) => a.py - b.py);
  const rotulosCabem = pontasOrdenadas.every((p, i) => i === 0 || p.py - pontasOrdenadas[i - 1].py >= 14);

  const indicesX = [...new Set([0, Math.floor((pontos.length - 1) / 2), pontos.length - 1])];

  const aoMover = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - MARGEM.left) / larguraInterna) * (pontos.length - 1));
    setFoco(Math.max(0, Math.min(pontos.length - 1, i)));
  };
  const aoTeclar = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setFoco((f) => {
      const atualIdx = f ?? pontos.length - 1;
      return Math.max(0, Math.min(pontos.length - 1, atualIdx + (e.key === "ArrowRight" ? 1 : -1)));
    });
  };

  const pontoFoco = foco != null ? pontos[foco] : null;
  const tooltipEsquerda = foco != null && x(foco) > largura - 190;

  return (
    <section className={`${cardClass} mb-6`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Evolução dos apontamentos</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Um retrato por dia, gravado ao fim da sincronização diária com a Sofit e ao abrir esta página.
          </p>
        </div>
        {atual && (
          <div className="text-right">
            <div className="text-3xl font-semibold text-slate-900">{fmt(atual.total)}</div>
            <div className="text-xs text-slate-500">
              apontamentos hoje
              {delta != null && base && (
                <>
                  {" · "}
                  <span className={delta < 0 ? "font-medium text-emerald-700" : delta > 0 ? "font-medium text-red-700" : "text-slate-500"}>
                    {delta < 0 ? "↓" : delta > 0 ? "↑" : "="} {fmt(Math.abs(delta))}
                    <span className="sr-only">{delta < 0 ? " a menos" : delta > 0 ? " a mais" : " sem mudança"}</span>
                  </span>{" "}
                  desde {diaLongo(base.dia)}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {!temGrafico ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
          O histórico começou a ser gravado{atual ? ` em ${diaLongo(atual.dia)}` : ""}. O gráfico aparece a partir do segundo dia registrado.
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600" aria-hidden="true">
            {SERIES.map((s) => (
              <span key={s.chave} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: s.cor }} />
                Gravidade {s.label.toLowerCase()}
              </span>
            ))}
          </div>

          <div ref={caixaRef} className="relative w-full" style={{ height: ALTURA }}>
            {largura > 0 && (
              <svg
                width={largura}
                height={ALTURA}
                role="img"
                aria-label={`Apontamentos por gravidade de ${diaLongo(pontos[0].dia)} a ${diaLongo(pontos[pontos.length - 1].dia)}. Use as setas para percorrer os dias.`}
                tabIndex={0}
                className="block touch-none outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                onPointerMove={aoMover}
                onPointerLeave={() => setFoco(null)}
                onFocus={() => setFoco(pontos.length - 1)}
                onBlur={() => setFoco(null)}
                onKeyDown={aoTeclar}
              >
                {[0, 1, 2, 3, 4].map((i) => {
                  const v = passo * i;
                  return (
                    <g key={i}>
                      <line x1={MARGEM.left} x2={MARGEM.left + larguraInterna} y1={y(v)} y2={y(v)} stroke={i === 0 ? EIXO : GRADE} strokeWidth={1} />
                      <text x={MARGEM.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[11px] tabular-nums">
                        {fmt(v)}
                      </text>
                    </g>
                  );
                })}

                {indicesX.map((i) => (
                  <text
                    key={i}
                    x={x(i)}
                    y={ALTURA - 8}
                    textAnchor={i === 0 ? "start" : i === pontos.length - 1 ? "end" : "middle"}
                    className="fill-slate-500 text-[11px] tabular-nums"
                  >
                    {diaCurto(pontos[i].dia)}
                  </text>
                ))}

                {foco != null && (
                  <line x1={x(foco)} x2={x(foco)} y1={MARGEM.top} y2={MARGEM.top + alturaInterna} stroke={EIXO} strokeWidth={1} />
                )}

                {SERIES.map((s) => (
                  <path
                    key={s.chave}
                    d={pontos.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p[s.chave])}`).join("")}
                    fill="none"
                    stroke={s.cor}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}

                {pontas.map((p) => (
                  <circle key={p.chave} cx={x(pontos.length - 1)} cy={p.py} r={4} fill={p.cor} stroke="#ffffff" strokeWidth={2} />
                ))}
                {foco != null &&
                  foco !== pontos.length - 1 &&
                  SERIES.map((s) => (
                    <circle key={s.chave} cx={x(foco)} cy={y(pontos[foco][s.chave])} r={4} fill={s.cor} stroke="#ffffff" strokeWidth={2} />
                  ))}

                {rotulosCabem &&
                  pontas.map((p) => (
                    <text key={p.chave} x={x(pontos.length - 1) + 10} y={p.py} dy="0.32em" className="fill-slate-700 text-[11px]">
                      {p.label} <tspan className="font-semibold tabular-nums">{fmt(p.valor)}</tspan>
                    </text>
                  ))}
              </svg>
            )}

            {pontoFoco && foco != null && (
              <div
                className="pointer-events-none absolute top-2 z-10 w-44 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
                style={tooltipEsquerda ? { left: Math.max(0, x(foco) - 188) } : { left: x(foco) + 12 }}
              >
                <div className="mb-1 font-medium text-slate-500">{diaLongo(pontoFoco.dia)}</div>
                {SERIES.map((s) => (
                  <div key={s.chave} className="flex items-center gap-2 py-0.5">
                    <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: s.cor }} />
                    <span className="font-semibold tabular-nums text-slate-900">{fmt(pontoFoco[s.chave])}</span>
                    <span className="text-slate-500">{s.label}</span>
                  </div>
                ))}
                <div className="mt-1 flex items-center gap-2 border-t border-slate-100 pt-1">
                  <span className="font-semibold tabular-nums text-slate-900">{fmt(pontoFoco.total)}</span>
                  <span className="text-slate-500">Total</span>
                </div>
              </div>
            )}
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">Ver os dados em tabela</summary>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">Dia</th>
                    {SERIES.map((s) => (
                      <th key={s.chave} className="py-1.5 pr-3 text-right font-medium">
                        {s.label}
                      </th>
                    ))}
                    <th className="py-1.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...pontos].reverse().map((p) => (
                    <tr key={p.dia} className="border-t border-slate-100">
                      <td className="py-1 pr-3 tabular-nums text-slate-700">{diaLongo(p.dia)}</td>
                      {SERIES.map((s) => (
                        <td key={s.chave} className="py-1 pr-3 text-right tabular-nums text-slate-700">
                          {fmt(p[s.chave])}
                        </td>
                      ))}
                      <td className="py-1 text-right font-medium tabular-nums text-slate-900">{fmt(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      {baseDia && variacao.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">O que mudou desde {diaLongo(baseDia)}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Item da auditoria</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Antes</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Agora</th>
                  <th className="py-1.5 text-right font-medium">Variação</th>
                </tr>
              </thead>
              <tbody>
                {variacao.map((v) => {
                  const d = v.agora - v.antes;
                  return (
                    <tr key={v.chave} className="border-t border-slate-100">
                      <td className="py-1.5 pr-3 text-slate-700">{v.titulo}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">{fmt(v.antes)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-900">{fmt(v.agora)}</td>
                      <td className={`py-1.5 text-right font-medium tabular-nums ${d < 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {d < 0 ? "↓" : "↑"} {fmt(Math.abs(d))}
                        <span className="sr-only">{d < 0 ? " a menos" : " a mais"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
