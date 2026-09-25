import Link from "next/link";
import { addDays, format, subDays } from "date-fns";
import { AlertTriangle, ArrowLeft, CheckCircle2, Search, SearchCheck } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { cardClass, badgeClass, inputClass, primaryButtonClass } from "@/lib/ui";
import PageHeader from "@/components/ui/PageHeader";
import CheckboxDropdownFilter from "@/components/ui/CheckboxDropdownFilter";
import { brazilDayLabel } from "@/lib/date";
import { fetchExcecoesDoDia, type ExcecaoDia } from "@/lib/excecoesDia";
import { dataParam } from "@/lib/params";

const toArray = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);
const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const soDigitos = (s: string) => s.replace(/\D/g, "");

// Versao "em lote" da Auditoria do dia (../page.tsx): em vez de escolher 1
// motorista de cada vez, roda a mesma pergunta basica — "tem escala e
// ponto batendo nesse dia?" — pra TODOS de uma vez (ver lib/excecoesDia.ts,
// compartilhada com o painel Hoje). Com a frota inteira dando 180+ linhas
// num dia, os filtros seguem o mesmo padrao da tela de Motoristas: busca,
// selecao multipla por cadastro e um "Filtrar" so.
export default async function ExcecoesDoDiaPage({
  searchParams,
}: {
  searchParams: Promise<{
    data?: string;
    q?: string;
    tipo?: string;
    afastamento?: string;
    empregador?: string | string[];
    departamento?: string | string[];
    cargo?: string | string[];
  }>;
}) {
  const session = await requireRole("ADMIN", "GESTOR");
  const { data, q, tipo, afastamento, ...rawFiltros } = await searchParams;
  const empregador = toArray(rawFiltros.empregador);
  const departamento = toArray(rawFiltros.departamento);
  const cargo = toArray(rawFiltros.cargo);
  const busca = (q ?? "").trim();
  const tipoFiltro = tipo === "escala_sem_ponto" || tipo === "ponto_sem_escala" ? tipo : "";
  const afastamentoFiltro = afastamento === "com" || afastamento === "sem" ? afastamento : "";

  // Padrao: ontem, nao hoje — os crons (TiqueTaque/SIAT) rodam de
  // madrugada buscando o dia anterior, entao "hoje" costuma estar
  // incompleto e geraria falso positivo de "sem ponto"/"sem escala".
  const dayStart = dataParam(data, brazilDayLabel(-1));
  const dataISO = format(dayStart, "yyyy-MM-dd");

  const todas = await fetchExcecoesDoDia(session.companyId, dayStart);

  // Opcoes so com o que aparece nas divergencias do dia — filtro que nao
  // muda nada atrapalha mais do que ajuda.
  const opcoes = (campo: (e: ExcecaoDia) => string | null) =>
    [...new Set(todas.map(campo).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const empregadores = opcoes((e) => e.empregador);
  const departamentos = opcoes((e) => e.departamento);
  const cargos = opcoes((e) => e.funcao);

  const excecoes = todas.filter((e) => {
    if (tipoFiltro && e.tipo !== tipoFiltro) return false;
    if (afastamentoFiltro === "sem" && e.afastamento) return false;
    if (afastamentoFiltro === "com" && !e.afastamento) return false;
    if (empregador.length > 0 && !(e.empregador && empregador.includes(e.empregador))) return false;
    if (departamento.length > 0 && !(e.departamento && departamento.includes(e.departamento))) return false;
    if (cargo.length > 0 && !(e.funcao && cargo.includes(e.funcao))) return false;
    if (busca) {
      const digitos = soDigitos(busca);
      const casaNome = semAcento(e.driverName).includes(semAcento(busca));
      const casaCpf = digitos.length >= 3 && soDigitos(e.cpf).includes(digitos);
      if (!casaNome && !casaCpf) return false;
    }
    return true;
  });

  const semAfastamento = excecoes.filter((e) => !e.afastamento).length;
  const temFiltro = Boolean(busca || tipoFiltro || afastamentoFiltro || empregador.length || departamento.length || cargo.length);

  // Navegacao de dia preserva os filtros — trocar de dia costuma ser pra ver
  // o mesmo recorte no dia anterior.
  const hrefDoDia = (dia: string) => {
    const p = new URLSearchParams();
    p.set("data", dia);
    if (busca) p.set("q", busca);
    if (tipoFiltro) p.set("tipo", tipoFiltro);
    if (afastamentoFiltro) p.set("afastamento", afastamentoFiltro);
    for (const v of empregador) p.append("empregador", v);
    for (const v of departamento) p.append("departamento", v);
    for (const v of cargo) p.append("cargo", v);
    return `/utilizacao/auditoria/excecoes?${p.toString()}`;
  };

  return (
    <div>
      <div className="mb-4" data-print-hide>
        <Link href="/utilizacao/auditoria" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Ir pra auditoria motorista a motorista
        </Link>
      </div>

      <PageHeader
        title="Exceções do dia"
        subtitle="Todo mundo com escala e ponto que não batem, num dia só — sem precisar escolher motorista por motorista."
      />

      <div className="mb-4 flex items-center justify-between">
        <Link href={hrefDoDia(format(subDays(dayStart, 1), "yyyy-MM-dd"))} className="text-sm font-medium text-slate-600 hover:underline">
          ← {format(subDays(dayStart, 1), "dd/MM")}
        </Link>
        <div>
          <p className="text-sm font-medium text-slate-700">{format(dayStart, "dd/MM/yyyy")}</p>
          <form method="get" className="mt-1 flex items-center gap-2" data-print-hide>
            <input type="date" name="data" defaultValue={dataISO} className={`${inputClass} py-1 text-xs`} />
            <button type="submit" className={`${primaryButtonClass} py-1 text-xs`}>
              Ir
            </button>
          </form>
        </div>
        <Link href={hrefDoDia(format(addDays(dayStart, 1), "yyyy-MM-dd"))} className="text-sm font-medium text-slate-600 hover:underline">
          {format(addDays(dayStart, 1), "dd/MM")} →
        </Link>
      </div>

      {todas.length > 0 && (
        <form className="mb-4 flex flex-wrap items-end gap-3" method="get" data-print-hide>
          <input type="hidden" name="data" value={dataISO} />
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">Buscar</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="text" name="q" defaultValue={busca} placeholder="Nome ou CPF" className={`${inputClass} pl-9`} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Divergência</label>
            <select name="tipo" defaultValue={tipoFiltro} className={inputClass}>
              <option value="">Todas</option>
              <option value="escala_sem_ponto">Escala sem ponto batido</option>
              <option value="ponto_sem_escala">Ponto batido sem escala</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Afastamento</label>
            <select name="afastamento" defaultValue={afastamentoFiltro} className={inputClass}>
              <option value="">Todos</option>
              <option value="sem">Sem afastamento</option>
              <option value="com">Com afastamento</option>
            </select>
          </div>
          {empregadores.length > 0 && (
            <div className="w-56">
              <CheckboxDropdownFilter
                name="empregador"
                label="Empregador"
                allLabel="Todos"
                defaultValue={empregador}
                options={empregadores.map((v) => ({ value: v, label: v }))}
              />
            </div>
          )}
          {departamentos.length > 0 && (
            <div className="w-56">
              <CheckboxDropdownFilter
                name="departamento"
                label="Unidade de alocação"
                allLabel="Todas"
                defaultValue={departamento}
                options={departamentos.map((v) => ({ value: v, label: v }))}
              />
            </div>
          )}
          {cargos.length > 0 && (
            <div className="w-56">
              <CheckboxDropdownFilter
                name="cargo"
                label="Cargo"
                allLabel="Todos"
                defaultValue={cargo}
                options={cargos.map((v) => ({ value: v, label: v }))}
              />
            </div>
          )}
          <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Filtrar
          </button>
          {temFiltro && (
            <Link href={`/utilizacao/auditoria/excecoes?data=${dataISO}`} className="pb-2 text-sm font-medium text-blue-700 hover:underline">
              Limpar filtros
            </Link>
          )}
        </form>
      )}

      {todas.length === 0 ? (
        <div className={`${cardClass} flex flex-col items-center gap-2 py-12 text-center text-emerald-700`}>
          <CheckCircle2 className="h-8 w-8" />
          <p className="text-sm font-medium">Nenhuma divergência de escala x ponto nesse dia.</p>
        </div>
      ) : excecoes.length === 0 ? (
        <div className={`${cardClass} py-10 text-center text-sm text-slate-500`}>
          Nenhum motorista com os filtros aplicados. O dia tem {todas.length} divergência(s) no total.
        </div>
      ) : (
        <div className={cardClass}>
          <p className="mb-3 text-sm text-slate-500">
            {semAfastamento} motorista(s) com divergência real
            {excecoes.length > semAfastamento && ` · ${excecoes.length - semAfastamento} explicado(s) por afastamento`}
            {temFiltro && ` · filtrando ${excecoes.length} de ${todas.length} do dia`}.
          </p>
          <ul className="divide-y divide-slate-100">
            {excecoes.map((e) => (
              <li key={e.driverId} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{e.driverName}</p>
                  {(e.funcao || e.departamento || e.empregador) && (
                    <p className="text-xs text-slate-500">{[e.funcao, e.departamento, e.empregador].filter(Boolean).join(" · ")}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`${badgeClass} ${e.afastamento ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700"}`}>
                      {e.tipo === "escala_sem_ponto" ? (
                        <>
                          <AlertTriangle className="mr-1 h-3 w-3" /> Escala sem ponto batido
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="mr-1 h-3 w-3" /> Ponto batido sem escala
                        </>
                      )}
                    </span>
                    {e.afastamento && <span className={`${badgeClass} bg-slate-100 text-slate-500`}>{e.afastamento}</span>}
                  </div>
                </div>
                <Link
                  href={`/utilizacao/auditoria?driverId=${e.driverId}&data=${dataISO}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <SearchCheck className="h-3.5 w-3.5" /> Ver detalhes
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Não cruza Ituran nem abastecimento aqui (isso é por veículo, mais pesado de rodar pra empresa inteira de uma
        vez) — clique em &quot;Ver detalhes&quot; pra essa auditoria completa de um motorista/dia específico.
      </p>
    </div>
  );
}
