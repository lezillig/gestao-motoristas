import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Hoje } from "@/lib/hoje";
import { MULTAS_PRAZO_JANELA_DIAS } from "@/lib/hoje";

function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function brl(cents: number | null): string {
  return cents == null ? "—" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Secao = { titulo: string; count: number; tom: "critico" | "aviso" | "info"; linhas: string[]; rodape?: string; href: string };

const COR = { critico: "#b91c1c", aviso: "#b45309", info: "#475569" };
const FUNDO = { critico: "#fee2e2", aviso: "#fef3c7", info: "#f1f5f9" };

// Mesmo conteudo do painel /hoje, em HTML de e-mail (tabelas/inline style,
// sem CSS externo — clientes de e-mail ignoram <style>). So entram as secoes
// com pendencia; sem nenhuma, o e-mail diz "tudo em dia" (e enviado mesmo
// assim: um dia SEM e-mail deve significar falha do robo, nao dia calmo).
export function renderHojeEmail(hoje: Hoje, opts: { companyName: string; baseUrl: string }): { subject: string; html: string } {
  const base = opts.baseUrl.replace(/\/$/, "");
  const ontemISO = format(hoje.ontemLabel, "yyyy-MM-dd");
  const dataExtenso = format(hoje.hojeLabel, "EEEE, d 'de' MMMM", { locale: ptBR });
  const titulo = `${dataExtenso.charAt(0).toUpperCase()}${dataExtenso.slice(1)}`;

  const todasSecoes: Secao[] = [
    {
      titulo: `Multas — prazo de indicação em até ${MULTAS_PRAZO_JANELA_DIAS} dias`,
      count: hoje.multas.vencendo,
      tom: "critico",
      href: `${base}/multas?sort=dataLimiteIndicacao&dir=asc`,
      linhas: hoje.multas.itens.map(
        (m) =>
          `<b>${esc(m.placa)}</b>${m.ait ? ` · AIT ${esc(m.ait)}` : ""} — vence ${m.diasRestantes === 0 ? "hoje" : `em ${m.diasRestantes}d`} (${format(m.dataLimiteIndicacao, "dd/MM")}) · ${brl(m.valorCents)} · ${m.condutorSugerido ? `condutor: ${esc(m.condutorSugerido)}` : "<span style=\"color:#b45309\">sem condutor definido</span>"}`
      ),
      rodape: hoje.multas.vencidas > 0 ? `${hoje.multas.vencidas} multa(s) já com prazo vencido sem indicação enviada.` : undefined,
    },
    {
      titulo: "CNH vencida ou vencendo em 30 dias",
      count: hoje.cnh.vencidas + hoje.cnh.venceEmBreve,
      tom: hoje.cnh.vencidas > 0 ? "critico" : "aviso",
      href: `${base}/cadastros/motoristas?status=ativo&cnhStatus=vencida`,
      linhas: hoje.cnh.itens.map((c) => {
        const nivel = c.nivel === "vencida" ? `vencida há ${Math.abs(c.diasParaVencer ?? 0)}d` : `vence em ${c.diasParaVencer}d`;
        const viagem = c.proximaViagem
          ? ` — <span style="color:#b45309">viagem em ${format(c.proximaViagem.date, "dd/MM")} às ${esc(c.proximaViagem.startTime)}${c.substitutos.length > 0 ? `, livre(s): ${esc(c.substitutos.map((s) => s.driverName).join(", "))}` : ", sem substituto livre"}</span>`
          : "";
        return `<b>${esc(c.driverName)}</b> — CNH ${esc(c.cnhCategory ?? "—")} ${nivel}${c.afastamento ? ` (${esc(c.afastamento)})` : ""}${viagem}`;
      }),
    },
    {
      titulo: `Escala x ponto de ontem (${format(hoje.ontemLabel, "dd/MM")})`,
      count: hoje.excecoesOntem.semAfastamento,
      tom: "aviso",
      href: `${base}/utilizacao/auditoria/excecoes?data=${ontemISO}`,
      linhas: hoje.excecoesOntem.itens
        .filter((e) => !e.afastamento)
        .map((e) => `<b>${esc(e.driverName)}</b> — ${e.tipo === "escala_sem_ponto" ? "escala no SIAT sem ponto batido" : "ponto batido sem escala no SIAT"}`),
    },
    {
      titulo: `Escalado ontem, sem viagem na Ituran (${format(hoje.ontemLabel, "dd/MM")})`,
      count: hoje.escalaSemViagem.total,
      tom: "aviso",
      href: `${base}/telemetria/viagens?dateFrom=${ontemISO}&dateTo=${ontemISO}`,
      linhas: hoje.escalaSemViagem.itens.map(
        (v) => `<b>${esc(v.plate)}</b> — ${esc(v.motoristas.join(", "))}${v.clientes.length > 0 ? ` · ${esc(v.clientes.join(", "))}` : ""} (${v.escalas} escala(s))`
      ),
      rodape: hoje.escalaSemViagem.ituranSemDadosOntem
        ? "A Ituran não trouxe nenhuma viagem ontem — provável falha de sincronização, não ausência real."
        : undefined,
    },
    {
      titulo: "Cartões de combustível bloqueados ou com saldo baixo",
      count: hoje.cartoes.length,
      tom: "aviso",
      href: `${base}/combustivel/cartoes`,
      linhas: hoje.cartoes.map((c) => `<b>${esc(c.plate)}</b> · cartão ${esc(c.numeroCartao)} — ${c.situacao === "bloqueado" ? "bloqueado" : "saldo baixo"} (${brl(c.saldoCents)} de ${brl(c.limiteCents)})`),
    },
    {
      titulo: "Integrações sem dados",
      count: hoje.integracoes.length,
      tom: "aviso",
      href: `${base}/integracoes`,
      linhas: hoje.integracoes.map((i) => `<b>${esc(i.sistema)}</b> — sem dados em ${i.missingDays.map((d) => format(new Date(`${d}T12:00:00`), "dd/MM")).join(", ")}`),
    },
    {
      titulo: "Manutenção preventiva pendente",
      count: hoje.manutencao.length,
      tom: "aviso",
      href: `${base}/utilizacao`,
      linhas: hoje.manutencao.map((m) => `<b>${esc(m.plate)}</b> — ${m.kmDesde.toLocaleString("pt-BR")} km desde a última`),
    },
    {
      titulo: "Motoristas afastados hoje",
      count: hoje.afastadosHoje.length,
      tom: "info",
      href: `${base}/afastamentos`,
      linhas: hoje.afastadosHoje.map((a) => `${esc(a.driverName)} — ${esc(a.tipo)} até ${format(a.ate, "dd/MM")}`),
    },
  ];
  const secoes = todasSecoes.filter((s) => s.count > 0);

  const tudoEmDia = hoje.urgentes === 0 && hoje.avisos === 0;
  const subject = tudoEmDia
    ? `Hoje ${format(hoje.hojeLabel, "dd/MM")} — tudo em dia`
    : `Hoje ${format(hoje.hojeLabel, "dd/MM")} — ${hoje.urgentes} urgente(s), ${hoje.avisos} aviso(s)`;

  const secoesHtml = secoes
    .map(
      (s) => `
      <tr><td style="padding:18px 0 0 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px">
          <tr><td style="padding:12px 16px 4px 16px;font-size:14px;font-weight:600;color:#0f172a">
            ${esc(s.titulo)}
            <span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;font-size:12px;background:${FUNDO[s.tom]};color:${COR[s.tom]}">${s.count}</span>
          </td></tr>
          <tr><td style="padding:0 16px 8px 16px;font-size:13px;line-height:1.5;color:#334155">
            ${s.linhas.map((l) => `<div style="padding:4px 0;border-top:1px solid #f1f5f9">${l}</div>`).join("")}
            ${s.count > s.linhas.length ? `<div style="padding:4px 0;color:#64748b">… e mais ${s.count - s.linhas.length}.</div>` : ""}
            ${s.rodape ? `<div style="padding:6px 0 0 0;color:#64748b;font-size:12px">${esc(s.rodape)}</div>` : ""}
          </td></tr>
          <tr><td style="padding:0 16px 12px 16px;font-size:12px"><a href="${s.href}" style="color:#1d4ed8;text-decoration:none">Ver no sistema →</a></td></tr>
        </table>
      </td></tr>`
    )
    .join("");

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f8fafc;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
      <tr><td style="font-size:20px;font-weight:700">Hoje — ${esc(titulo)}</td></tr>
      <tr><td style="padding:4px 0 0 0;font-size:13px;color:#64748b">${esc(opts.companyName)} · ${hoje.resumo.escalasHoje} escala(s) hoje · ${hoje.resumo.motoristasEscalados} motorista(s) · ${hoje.resumo.veiculosEscalados} veículo(s)</td></tr>
      <tr><td style="padding:14px 0 0 0">
        <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:600;background:${hoje.urgentes > 0 ? FUNDO.critico : "#dcfce7"};color:${hoje.urgentes > 0 ? COR.critico : "#15803d"}">${hoje.urgentes} urgente(s)</span>
        <span style="display:inline-block;margin-left:6px;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:600;background:${hoje.avisos > 0 ? FUNDO.aviso : "#dcfce7"};color:${hoje.avisos > 0 ? COR.aviso : "#15803d"}">${hoje.avisos} aviso(s)</span>
      </td></tr>
      ${
        tudoEmDia
          ? `<tr><td style="padding:18px 0 0 0"><div style="padding:14px 16px;border-radius:12px;background:#dcfce7;color:#166534;font-size:14px;font-weight:600">Tudo em dia — nenhuma pendência que precise de decisão hoje.</div></td></tr>`
          : secoesHtml
      }
      <tr><td style="padding:22px 0 0 0;font-size:12px;color:#94a3b8">
        <a href="${base}/hoje" style="color:#1d4ed8;text-decoration:none">Abrir o painel Hoje</a> · Ontem é o último dia fechado: os robôs buscam D-1 de madrugada. Cada bloco usa o mesmo cálculo da tela de origem.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, html };
}
