import Link from "next/link";
import { addMonths, format, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Banknote, ChevronLeft, ChevronRight, Clock, Coins, Fuel, Gauge, Gavel, Route } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { cardClass, badgeClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import { buildCustosMes, parseMes, SEM_CLIENTE, SEM_ESCALA } from "@/lib/custos";

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function brlPorKm(cents: number | null): string {
  return cents == null ? "—" : `${(cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })}/km`;
}
function horas(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h${String(m).padStart(2, "0")}`;
}
function num(n: number, digits = 0): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className={cardClass}>
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-xl font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

const TH = "px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500";
const TH_NUM = `${TH} text-right`;
const TD = "px-4 py-2.5 text-slate-700";
const TD_NUM = `${TD} text-right tabular-nums`;

export default async function CustosPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { mes } = await searchParams;
  const monthStart = parseMes(mes);
  const custos = await buildCustosMes(session.companyId, monthStart);
  const { totais } = custos;
  const prev = format(subMonths(monthStart, 1), "yyyy-MM");
  const next = format(addMonths(monthStart, 1), "yyyy-MM");
  const temMaoDeObra = totais.maoDeObraCents > 0;
  const semDados = custos.veiculos.length === 0 && custos.clientes.length === 0;

  return (
    <div>
      <PageHeader
        title="Custo por veículo e por cliente"
        subtitle="Combustível, multas, km real da Ituran e horas de motorista, juntos — quanto custa cada veículo e cada contrato por km rodado."
      />

      <div className="mb-6 flex items-center justify-between">
        <Link href={`/custos?mes=${prev}`} className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:underline">
          <ChevronLeft className="h-4 w-4" /> Mês anterior
        </Link>
        <p className="text-sm font-medium capitalize text-slate-700">{format(monthStart, "MMMM/yyyy", { locale: ptBR })}</p>
        <Link href={`/custos?mes=${next}`} className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:underline">
          Próximo mês <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Tile icon={Banknote} label="Custo total do mês" value={brl(totais.totalCents)} sub={temMaoDeObra ? "combustível + multas + mão de obra" : "combustível + multas"} />
        <Tile icon={Route} label="Km rodados (Ituran)" value={`${num(totais.km)} km`} sub={`${num(totais.viagens)} viagens · ${num(totais.viagensSemEscala)} sem escala`} />
        <Tile icon={Coins} label="Custo por km" value={brlPorKm(totais.km > 0 ? totais.totalCents / totais.km : null)} />
        <Tile
          icon={Fuel}
          label="Combustível"
          value={brl(totais.combustivelCents)}
          sub={`${num(totais.litros)} L · ${brlPorKm(totais.km > 0 && totais.combustivelCents > 0 ? totais.combustivelCents / totais.km : null)}`}
        />
        <Tile icon={Gauge} label="Km por litro (frota)" value={totais.km > 0 && totais.litros > 0 ? `${num(totais.km / totais.litros, 2)} km/L` : "—"} sub="km Ituran ÷ litros abastecidos" />
        <Tile
          icon={Clock}
          label="Horas de motorista"
          value={horas(totais.horasMin)}
          sub={temMaoDeObra ? `${brl(totais.maoDeObraCents)} de mão de obra` : "sem valor-hora cadastrado"}
        />
      </div>

      {semDados ? (
        <div className={`${cardClass} py-10 text-center text-sm text-slate-500`}>Nenhum abastecimento, multa, viagem ou escala nesse mês.</div>
      ) : (
        <>
          <section className={`${cardClass} mb-6 p-0 overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Por cliente / contrato</h2>
              <span className="text-xs text-slate-400">cliente da escala do SIAT · combustível e multas rateados pelos dias de escala do veículo</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={TH}>Cliente</th>
                    <th className={TH_NUM}>Veíc. · Mot.</th>
                    <th className={TH_NUM}>Dias escala</th>
                    <th className={TH_NUM}>Km</th>
                    <th className={TH_NUM}>Horas</th>
                    <th className={TH_NUM}>Combustível</th>
                    <th className={TH_NUM}>Multas</th>
                    {temMaoDeObra && <th className={TH_NUM}>Mão de obra</th>}
                    <th className={TH_NUM}>Total</th>
                    <th className={TH_NUM}>R$/km</th>
                    <th className={TH_NUM}>R$/hora</th>
                  </tr>
                </thead>
                <tbody>
                  {custos.clientes.map((c) => {
                    const especial = c.nome === SEM_ESCALA || c.nome === SEM_CLIENTE;
                    return (
                      <tr key={c.nome} className={`border-t border-slate-100 ${especial ? "bg-slate-50/60" : ""}`}>
                        <td className={`${TD} font-medium`}>
                          {c.nome}
                          {especial && <span className={`${badgeClass} ml-2 bg-slate-100 text-slate-500`}>não atribuído</span>}
                        </td>
                        <td className={TD_NUM}>
                          {c.veiculos} · {c.motoristas}
                        </td>
                        <td className={TD_NUM}>{c.escalaDias}</td>
                        <td className={TD_NUM}>{num(c.km)}</td>
                        <td className={TD_NUM}>
                          {horas(c.horasMin)}
                          {c.semValorHora && temMaoDeObra && <span title="Parte dos motoristas sem valor-hora cadastrado" className="ml-1 text-amber-600">*</span>}
                        </td>
                        <td className={TD_NUM}>{brl(c.combustivelCents)}</td>
                        <td className={TD_NUM}>
                          {brl(c.multasCents)}
                          {c.multasQtd > 0 && <span className="ml-1 text-xs text-slate-400">({num(c.multasQtd, 1)})</span>}
                        </td>
                        {temMaoDeObra && <td className={TD_NUM}>{brl(c.maoDeObraCents)}</td>}
                        <td className={`${TD_NUM} font-semibold text-slate-900`}>{brl(c.totalCents)}</td>
                        <td className={TD_NUM}>{brlPorKm(c.custoPorKmCents)}</td>
                        <td className={TD_NUM}>{c.custoPorHoraCents == null ? "—" : `${brl(c.custoPorHoraCents)}/h`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${cardClass} p-0 overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Por veículo</h2>
              <span className="text-xs text-slate-400">ordenado pelo custo total</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={TH}>Veículo</th>
                    <th className={TH}>Clientes no mês</th>
                    <th className={TH_NUM}>Km</th>
                    <th className={TH_NUM}>Viagens</th>
                    <th className={TH_NUM}>Litros</th>
                    <th className={TH_NUM}>Km/L</th>
                    <th className={TH_NUM}>Combustível</th>
                    <th className={TH_NUM}>Multas</th>
                    <th className={TH_NUM}>Horas mot.</th>
                    {temMaoDeObra && <th className={TH_NUM}>Mão de obra</th>}
                    <th className={TH_NUM}>Total</th>
                    <th className={TH_NUM}>R$/km</th>
                  </tr>
                </thead>
                <tbody>
                  {custos.veiculos.map((v) => {
                    const semKm = v.km === 0 && v.totalCents > 0;
                    const kmlSuspeito = v.kmPorLitro != null && (v.kmPorLitro < 1.5 || v.kmPorLitro > 20);
                    return (
                      <tr key={v.vehicleId} className="border-t border-slate-100">
                        <td className={TD}>
                          <span className="font-mono font-medium">{v.plate}</span>
                          <span className="ml-2 text-xs text-slate-500">{v.modelo}</span>
                          {semKm && (
                            <span className={`${badgeClass} ml-2 bg-amber-100 text-amber-700`} title="Tem custo no mês mas nenhuma viagem sincronizada da Ituran">
                              sem km na Ituran
                            </span>
                          )}
                        </td>
                        <td className={`${TD} max-w-[260px] truncate text-xs text-slate-500`} title={v.clientes.join(", ")}>
                          {v.clientes.length === 0 ? "—" : v.clientes.join(", ")}
                        </td>
                        <td className={TD_NUM}>{num(v.km)}</td>
                        <td className={TD_NUM}>
                          {v.viagens}
                          {v.viagensSemEscala > 0 && <span className="ml-1 text-xs text-slate-400">({v.viagensSemEscala} s/ escala)</span>}
                        </td>
                        <td className={TD_NUM}>{num(v.litros)}</td>
                        <td className={`${TD_NUM} ${kmlSuspeito ? "font-medium text-amber-700" : ""}`} title={kmlSuspeito ? "Fora da faixa plausível — km da Ituran e litros do cartão podem não cobrir o mesmo período" : undefined}>
                          {v.kmPorLitro == null ? "—" : num(v.kmPorLitro, 2)}
                        </td>
                        <td className={TD_NUM}>{brl(v.combustivelCents)}</td>
                        <td className={TD_NUM}>
                          {brl(v.multasCents)}
                          {v.multasQtd > 0 && <span className="ml-1 text-xs text-slate-400">({v.multasQtd})</span>}
                        </td>
                        <td className={TD_NUM}>{horas(v.horasMin)}</td>
                        {temMaoDeObra && <td className={TD_NUM}>{brl(v.maoDeObraCents)}</td>}
                        <td className={`${TD_NUM} font-semibold text-slate-900`}>{brl(v.totalCents)}</td>
                        <td className={TD_NUM}>{brlPorKm(v.custoPorKmCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <div className={`${cardClass} mt-4 text-xs text-slate-500`}>
        <p className="mb-1 font-medium text-slate-700">Como o custo é montado</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            <Route className="mr-1 inline h-3 w-3" />
            Km: viagens da Ituran. Cada viagem aponta pra escala do SIAT do veículo naquele dia — por isso o km por cliente é exato.
            Viagem sem escala vai pra &quot;{SEM_ESCALA}&quot;.
          </li>
          <li>
            <Fuel className="mr-1 inline h-3 w-3" />
            <Gavel className="mr-1 inline h-3 w-3" />
            Combustível e multas são do veículo, não da viagem: rateados entre os clientes que o veículo atendeu no mês, proporcional aos
            dias de escala de cada um. Abastecimento sem veículo reconhecido ({brl(totais.combustivelSemVeiculoCents)}) e multa sem
            veículo ({brl(totais.multasSemVeiculoCents)}) ficam fora.
          </li>
          <li>
            <Clock className="mr-1 inline h-3 w-3" />
            Horas: ponto batido do motorista no dia, atribuído à(s) escala(s) dele naquele dia (dividido se houver mais de uma). Mão de
            obra só entra pra quem tem valor-hora no cadastro
            {totais.motoristasSemValorHora > 0 && ` — ${totais.motoristasSemValorHora} motorista(s) com ponto no mês ainda sem valor-hora`}.
            Hora extra, adicional noturno e encargos não estão incluídos (ver Análise de riscos e Passivo trabalhista).
          </li>
        </ul>
      </div>
    </div>
  );
}
