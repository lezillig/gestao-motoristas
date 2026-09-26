#!/usr/bin/env node
// Extracao em massa do TiqueTaque para conferencia de folha.
//
// Roda FORA do Next (node puro, sem dependencia nenhuma) de proposito: e um
// job longo (milhares de chamadas pagueadas a 1.1s) que nao cabe no teto de
// 60s da Vercel, e precisa poder ser interrompido e retomado. A logica de
// autenticacao, paginacao e backoff de 429 espelha src/lib/tiquetaque/client.ts
// — se um dos dois mudar, o outro precisa acompanhar.
//
//   TIQUETAQUE_API_TOKEN=... node scripts/tiquetaque-export.mjs \
//     --start 2025-12-01 --end 2026-09-24 --out ./export-tiquetaque
//
// Flags:
//   --start / --end   periodo (AAAA-MM-DD), obrigatorios
//   --out             diretorio de saida (padrao ./export-tiquetaque)
//   --only            times,leaves,timesheets (padrao: os tres)
//   --resume          continua de onde parou usando o checkpoint do --out
//
// Gera CSV (';' + BOM, abre no Excel pt-BR sem passar pelo assistente de
// importacao): marcacoes.csv, afastamentos.csv, espelho_mensal.csv,
// espelho_diario.csv e funcionarios.csv.

import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// TIQUETAQUE_API_BASE existe para apontar o script a um servidor de teste que
// imita a API; sem ela, vai na API real.
const BASE_URL = process.env.TIQUETAQUE_API_BASE || "https://api.tiquetaque.com/v2.1";
// 60 req/min e o limite real da API (ver src/lib/tiquetaque/pace.ts). 1.1s
// entre chamadas mantem ~54/min, com margem.
const PACE_MS = Number(process.env.TIQUETAQUE_PACE_MS || 1100);
const MAX_RETRIES = 3;

// ---------------------------------------------------------------- argumentos

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const START = args.start;
const END = args.end;
const OUT = args.out || "./export-tiquetaque";
const ONLY = String(args.only || "times,leaves,timesheets")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const RESUME = Boolean(args.resume);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
if (!DATE_RE.test(START || "") || !DATE_RE.test(END || "")) {
  console.error("Uso: --start AAAA-MM-DD --end AAAA-MM-DD [--out DIR] [--only times,leaves,timesheets] [--resume]");
  process.exit(1);
}
if (START > END) {
  console.error(`Periodo invertido: inicio ${START} e posterior ao fim ${END}.`);
  process.exit(1);
}
const TOKEN = process.env.TIQUETAQUE_API_TOKEN;
if (!TOKEN) {
  console.error(
    "TIQUETAQUE_API_TOKEN nao definida.\n" +
      "Defina a variavel no ambiente (nao passe o token por argumento de linha de\n" +
      "comando: ele fica no historico do shell e na lista de processos)."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------- http

const authHeader = "Basic " + Buffer.from(`public:${TOKEN}`).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chamadas = 0;

async function api(path, attempt = 0) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: authHeader } });
  chamadas++;
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const backoff = 2000 * 2 ** attempt;
    process.stderr.write(`  429 em ${path} — aguardando ${backoff / 1000}s\n`);
    await sleep(backoff);
    return api(path, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TiqueTaque respondeu ${res.status} em ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ------------------------------------------------------------------- planilha

const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// `feitos` null = arquivo escrito de uma vez so (o cadastro), sempre
// recriado do zero. Com um Set, o arquivo e alimentado funcionario a
// funcionario e precisa da limpeza de linhas parciais na retomada.
function criarCsv(nome, colunas, feitos) {
  const caminho = join(OUT, nome);
  if (feitos && RESUME && existsSync(caminho)) {
    // O checkpoint so registra um funcionario DEPOIS que os tres relatorios
    // dele foram gravados. Se a execucao morreu no meio de um funcionario,
    // sobraram linhas dele no CSV sem que ele conste como feito — e a
    // retomada iria grava-las de novo. Entao, ao retomar, o arquivo e
    // reescrito mantendo so o cabecalho e as linhas de quem esta no
    // checkpoint. Sem isso, uma queda de rede vira batida duplicada.
    const linhas = readFileSync(caminho, "utf8").split("\n");
    const cabecalho = linhas[0];
    const mantidas = linhas.slice(1).filter((l) => l && feitos.has(l.slice(0, l.indexOf(";"))));
    writeFileSync(caminho, [cabecalho, ...mantidas].join("\n") + (mantidas.length ? "\n" : ""), "utf8");
  } else {
    writeFileSync(caminho, "﻿" + colunas.join(";") + "\n", "utf8");
  }
  return {
    caminho,
    escrever(linhas) {
      if (!linhas.length) return;
      appendFileSync(caminho, linhas.map((l) => l.map(csvCell).join(";")).join("\n") + "\n", "utf8");
    },
  };
}

// ---------------------------------------------------------------- checkpoint

const CHECKPOINT = join(OUT, "_checkpoint.json");

function lerCheckpoint() {
  if (!RESUME || !existsSync(CHECKPOINT)) return { feitos: [] };
  try {
    return JSON.parse(readFileSync(CHECKPOINT, "utf8"));
  } catch {
    return { feitos: [] };
  }
}

function gravarCheckpoint(estado) {
  writeFileSync(CHECKPOINT, JSON.stringify(estado), "utf8");
}

// -------------------------------------------------------------------- coleta

async function buscarFuncionarios() {
  const todos = [];
  for (let page = 1; ; page++) {
    const data = await api(`/employees?max_results=200&page=${page}`);
    const items = data._items ?? [];
    for (const it of items) {
      todos.push({
        id: it._id,
        nome: (it.full_name || "").trim(),
        cpf: (it.cpf || "").replace(/\D/g, ""),
        cargo: it.contract_data?.job_role?.trim() || "",
        departamento: it.contract_data?.department?.trim() || "",
        demitido: Boolean(it.contract_data?.dismissal_date),
        demissao: it.contract_data?.dismissal_date?.slice(0, 10) || "",
      });
    }
    const total = data._meta?.total ?? todos.length;
    if (todos.length >= total || items.length < 200) break;
    await sleep(PACE_MS);
  }
  return todos;
}

// Lista de competencias (AAAA-MM) tocadas pelo periodo. O espelho e puxado
// MES A MES, e nao de uma vez: e assim que ele fica comparavel com cada
// fechamento de folha, que tambem e mensal.
function competencias(inicio, fim) {
  const out = [];
  let [a, m] = [Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7))];
  const [af, mf] = [Number(fim.slice(0, 4)), Number(fim.slice(5, 7))];
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; a++; }
  }
  return out;
}

const ultimoDia = (comp) => {
  const [a, m] = comp.split("-").map(Number);
  return `${comp}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
};

const num = (v) => {
  const n = parseFloat(String(v ?? "0"));
  return Number.isNaN(n) ? 0 : n;
};

// ---------------------------------------------------------------------- main

async function main() {
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const estado = lerCheckpoint();
  const feitos = new Set(estado.feitos || []);

  console.log(`Periodo: ${START} a ${END}`);
  console.log(`Relatorios: ${ONLY.join(", ")}`);
  console.log(`Saida: ${OUT}${RESUME ? "  (retomando)" : ""}\n`);

  const funcionarios = await buscarFuncionarios();
  console.log(`Funcionarios: ${funcionarios.length}\n`);

  const fCsv = criarCsv("funcionarios.csv", ["employee_id", "nome", "cpf", "cargo", "departamento", "demitido", "demissao"], null);
  // Cadastro completo, sempre reescrito por inteiro — independe do progresso.
  fCsv.escrever(funcionarios.map((f) => [f.id, f.nome, f.cpf, f.cargo, f.departamento, f.demitido ? "sim" : "nao", f.demissao]));

  const comps = competencias(START, END);
  const quer = (n) => ONLY.includes(n);

  const marc = quer("times")
    ? criarCsv("marcacoes.csv", ["employee_id", "nome", "cpf", "data", "hora", "tipo", "aprovado", "latitude", "longitude"], feitos)
    : null;
  const afast = quer("leaves")
    ? criarCsv("afastamentos.csv", ["employee_id", "nome", "cpf", "tipo", "inicio", "fim", "dias", "remunerado", "detalhes"], feitos)
    : null;
  const espM = quer("timesheets")
    ? criarCsv("espelho_mensal.csv", ["employee_id", "nome", "cpf", "competencia", "horas_normais", "extra_50", "extra_100", "adicional_noturno", "hora_noturna_reduzida", "dsr", "folga", "atraso", "total"], feitos)
    : null;
  const espD = quer("timesheets")
    ? criarCsv("espelho_diario.csv", ["employee_id", "nome", "cpf", "data", "total", "extra_50", "extra_100", "adicional_noturno", "horarios"], feitos)
    : null;

  // Uma chamada por funcionario para /times e /work-leaves; uma por
  // funcionario POR COMPETENCIA para /timesheets.
  const porFunc = (quer("times") ? 1 : 0) + (quer("leaves") ? 1 : 0) + (quer("timesheets") ? comps.length : 0);
  const restantes = funcionarios.filter((f) => !feitos.has(f.id)).length;
  const estimativaMin = Math.round((restantes * porFunc * PACE_MS) / 60000);
  console.log(`~${porFunc} chamadas por funcionario · ${restantes} pendentes · estimativa ~${estimativaMin} min\n`);

  let i = 0;
  for (const f of funcionarios) {
    i++;
    if (feitos.has(f.id)) continue;
    const rotulo = `[${String(i).padStart(3)}/${funcionarios.length}] ${f.nome.slice(0, 34).padEnd(34)}`;
    try {
      if (marc) {
        const data = await api(`/times?${new URLSearchParams({ start_date: START, end_date: END, employee_id: f.id })}`);
        const linhas = (data.times ?? []).map((t) => {
          const [lat, lon] = Array.isArray(t.location) ? t.location : [null, null];
          return [f.id, f.nome, f.cpf, String(t.time).slice(0, 10), String(t.time).slice(11, 19), t.type ?? "", t.approved ? "sim" : "nao", lat, lon];
        });
        marc.escrever(linhas);
        process.stdout.write(`${rotulo} ${String(linhas.length).padStart(4)} batidas`);
        await sleep(PACE_MS);
      }

      if (afast) {
        const todos = [];
        for (let page = 1; ; page++) {
          const data = await api(`/work-leaves?${new URLSearchParams({ employee_id: f.id, max_results: "200", page: String(page) })}`);
          const items = data._items ?? [];
          todos.push(...items);
          const total = data._meta?.total ?? todos.length;
          if (todos.length >= total || items.length < 200) break;
          await sleep(PACE_MS);
        }
        // /work-leaves nao aceita filtro de data — devolve o historico inteiro
        // da pessoa. O recorte do periodo e feito aqui, mantendo todo
        // afastamento que ENCOSTA na janela (nao so os contidos nela).
        const noPeriodo = todos.filter((l) => l.start_date.slice(0, 10) <= END && l.end_date.slice(0, 10) >= START);
        afast.escrever(
          noPeriodo.map((l) => {
            const ini = l.start_date.slice(0, 10);
            const fim = l.end_date.slice(0, 10);
            const dias = Math.round((Date.parse(fim) - Date.parse(ini)) / 86400000) + 1;
            return [f.id, f.nome, f.cpf, l.leave_type, ini, fim, dias, l.paid_leave === false ? "nao" : "sim", (l.details || "").trim()];
          })
        );
        process.stdout.write(` · ${String(noPeriodo.length).padStart(3)} afast.`);
        await sleep(PACE_MS);
      }

      if (espM) {
        let comHoras = 0;
        for (const comp of comps) {
          const ini = comp + "-01" < START ? START : comp + "-01";
          const fim = ultimoDia(comp) > END ? END : ultimoDia(comp);
          const data = await api(`/timesheets?${new URLSearchParams({ employee_id: f.id, start_date: ini, end_date: fim })}`);
          const t = data.totals ?? {};
          if (num(t.total) > 0) comHoras++;
          espM.escrever([[f.id, f.nome, f.cpf, comp, num(t.horas_normais), num(t.extra_50), num(t.extra_100), num(t.adicional_noturno), num(t.hora_noturna_reduzida), num(t.dsr), num(t.folga), num(t.atraso), num(t.total)]]);
          const dias = data.days ?? {};
          espD.escrever(
            Object.entries(dias).map(([dia, d]) => [
              f.id, f.nome, f.cpf, dia, num(d?.total), num(d?.extra_50), num(d?.extra_100), num(d?.adicional_noturno),
              Array.isArray(d?.horarios) ? d.horarios.join(" ") : "",
            ])
          );
          await sleep(PACE_MS);
        }
        process.stdout.write(` · ${String(comHoras).padStart(2)}/${comps.length} meses`);
      }

      process.stdout.write("\n");
      feitos.add(f.id);
      gravarCheckpoint({ feitos: [...feitos], start: START, end: END, only: ONLY });
    } catch (err) {
      process.stdout.write("\n");
      console.error(`  FALHOU em ${f.nome} (${f.id}): ${err.message}`);
      console.error(`  Progresso salvo. Rode de novo com --resume para continuar daqui.`);
      gravarCheckpoint({ feitos: [...feitos], start: START, end: END, only: ONLY });
      process.exit(2);
    }
  }

  const min = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\nConcluido em ${min} min · ${chamadas} chamadas a API`);
  for (const c of [fCsv, marc, afast, espM, espD]) if (c) console.log(`  ${c.caminho}`);
}

main().catch((err) => {
  console.error("Falha:", err.message);
  process.exit(1);
});
