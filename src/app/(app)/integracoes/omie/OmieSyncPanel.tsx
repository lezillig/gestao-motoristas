"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { inputClass, labelClass, primaryButtonClass, cardClass } from "@/lib/ui";
import type { SyncResultado } from "@/lib/omie/sync";
import type { OmieTipoTitulo } from "@/lib/omie/types";
import { sincronizarClientes, sincronizarTitulos } from "./actions";

type Execucao = { titulo: string; resultado: SyncResultado };

function ResultadoSync({ execucoes }: { execucoes: Execucao[] }) {
  return (
    <div className="space-y-2 border-t border-slate-200 pt-4">
      {execucoes.map((execucao, i) => {
        const { resultado } = execucao;
        const falhou = resultado.erro !== null;
        return (
          <div key={i} className="space-y-1.5">
            <div
              className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
                falhou ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {falhou ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>
                <span className="font-medium">{execucao.titulo}</span> — {resultado.criados} novo(s),{" "}
                {resultado.atualizados} atualizado(s), {resultado.ignorados} ignorado(s) em{" "}
                {resultado.paginasLidas} página(s).
                {falhou && <> A execução parou: {resultado.erro}</>}
              </span>
            </div>
            {resultado.interrompidoPorTempo && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  A leitura parou no meio por limite de tempo da execução — o que entrou está correto, mas
                  faltam páginas. Rode de novo para continuar (nada é duplicado).
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function primeiroDiaDoMes() {
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
}

function ultimoDiaDoMes() {
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export default function OmieSyncPanel({ disponivel }: { disponivel: boolean }) {
  const [rodando, setRodando] = useState<null | "clientes" | "financeiro">(null);
  const [erro, setErro] = useState<string | null>(null);
  const [execucoes, setExecucoes] = useState<Execucao[] | null>(null);

  async function handleClientes(formData: FormData) {
    const criarNovos = formData.get("criarNovos") === "on";
    setRodando("clientes");
    setErro(null);
    setExecucoes(null);

    const resposta = await sincronizarClientes(criarNovos);
    if ("error" in resposta) {
      setErro(resposta.error);
    } else {
      setExecucoes([{ titulo: "Clientes", resultado: resposta.resultado }]);
    }
    setRodando(null);
  }

  async function handleFinanceiro(formData: FormData) {
    const inicio = String(formData.get("inicio") ?? "");
    const fim = String(formData.get("fim") ?? "");
    const escolha = String(formData.get("tipo") ?? "RECEBER");
    const tipos: OmieTipoTitulo[] = escolha === "AMBOS" ? ["RECEBER", "PAGAR"] : [escolha as OmieTipoTitulo];

    setRodando("financeiro");
    setErro(null);
    setExecucoes(null);

    const resultados: Execucao[] = [];
    for (const tipo of tipos) {
      const resposta = await sincronizarTitulos(tipo, inicio, fim);
      if ("error" in resposta) {
        setErro(resposta.error);
        setRodando(null);
        return;
      }
      resultados.push({
        titulo: tipo === "RECEBER" ? "Contas a receber" : "Contas a pagar",
        resultado: resposta.resultado,
      });
      // Uma execução que já falhou (ex. bloqueio por consumo indevido do Omie)
      // não deve puxar a próxima: insistir é exatamente o que estende o
      // bloqueio (ver src/lib/omie/pace.ts).
      if (resposta.resultado.erro) break;
    }
    setExecucoes(resultados);
    setRodando(null);
  }

  return (
    <div className="space-y-6">
      <div className={cardClass}>
        <h2 className="text-sm font-semibold text-slate-800">Clientes</h2>
        <p className="mt-1 mb-4 text-sm text-slate-500">
          Casa o cadastro de clientes do Omie com os clientes/centros de custo daqui — por CNPJ/CPF e, quando
          o cadastro local não tem documento, por nome. O nome cadastrado aqui nunca é sobrescrito pelo do
          ERP.
        </p>
        <form action={handleClientes} className="space-y-3">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" name="criarNovos" disabled={rodando !== null} className="mt-0.5" />
            <span>
              Criar aqui os clientes do Omie que ainda não existem
              <span className="block text-xs text-slate-500">
                Desligado, só vincula o que já está cadastrado. Ligado, o cadastro do Omie inteiro entra —
                inclusive fornecedores, que também vivem lá.
              </span>
            </span>
          </label>
          <button type="submit" disabled={rodando !== null || !disponivel} className={primaryButtonClass}>
            {rodando === "clientes" ? "Sincronizando..." : "Sincronizar clientes"}
          </button>
        </form>
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-semibold text-slate-800">Financeiro</h2>
        <p className="mt-1 mb-4 text-sm text-slate-500">
          Espelha os títulos do período (filtrados por data de vencimento) para cruzar receita e custo por
          contrato com as horas apuradas aqui. É leitura: nada é escrito no Omie.
        </p>
        <form action={handleFinanceiro} className="flex flex-wrap items-end gap-4">
          <div>
            <label className={labelClass}>Vencimento de *</label>
            <input
              type="date"
              name="inicio"
              required
              defaultValue={primeiroDiaDoMes()}
              disabled={rodando !== null}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>até *</label>
            <input
              type="date"
              name="fim"
              required
              defaultValue={ultimoDiaDoMes()}
              disabled={rodando !== null}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Tipo</label>
            <select name="tipo" defaultValue="RECEBER" disabled={rodando !== null} className={inputClass}>
              <option value="RECEBER">Contas a receber</option>
              <option value="PAGAR">Contas a pagar</option>
              <option value="AMBOS">Os dois</option>
            </select>
          </div>
          <button type="submit" disabled={rodando !== null || !disponivel} className={primaryButtonClass}>
            {rodando === "financeiro" ? "Sincronizando..." : "Sincronizar"}
          </button>
        </form>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {execucoes && <ResultadoSync execucoes={execucoes} />}
    </div>
  );
}
