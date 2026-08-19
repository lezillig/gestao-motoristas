// Descobridor de endpoints da API do TiqueTaque.
//
//   npm run tiquetaque:discover
//   npm run tiquetaque:discover -- --json > tiquetaque-endpoints.json
//   npm run tiquetaque:discover -- employees times work-leaves
//
// Pergunta à propria API quais recursos existem (documento raiz do Eve) e
// sonda cada candidato pra ver quais respondem, quais verbos aceitam e que
// campos devolvem. Precisa de TIQUETAQUE_API_TOKEN (lido do ambiente ou do
// .env do projeto). So faz GET — nao escreve nada no TiqueTaque.
//
// Serve pra fechar a lacuna que o codigo nao consegue fechar sozinho: os
// wrappers em src/lib/tiquetaque/resources.ts so cobrem recursos
// confirmados, e a lista de confirmados so cresce com uma rodada disto.

import { readFileSync } from "node:fs";
import { CANDIDATE_RESOURCES, discoverResources, probeResources, type ResourceProbe } from "../src/lib/tiquetaque/discovery";

// Carrega o .env na mao: o script roda fora do Next (que injeta .env
// sozinho), e depender de `node --env-file` quebraria em quem nao tem o
// arquivo, que e justamente o caso em que a mensagem de erro precisa ser
// clara.
function loadDotEnv(): void {
  if (process.env.TIQUETAQUE_API_TOKEN) return;
  let contents: string;
  try {
    contents = readFileSync(".env", "utf8");
  } catch {
    return;
  }
  for (const line of contents.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

function statusLabel(probe: ResourceProbe): string {
  switch (probe.status) {
    case "ok":
      return "OK     ";
    case "missing":
      return "404    ";
    case "forbidden":
      return "SEM ACESSO";
    default:
      return `ERRO ${probe.httpStatus ?? "-"}`;
  }
}

function printProbe(probe: ResourceProbe): void {
  const parts = [`  ${statusLabel(probe)}  /${probe.resource}`];
  if (probe.total !== null) parts.push(`total=${probe.total}`);
  if (probe.allow?.length) parts.push(`allow=${probe.allow.join("|")}`);
  if (probe.message) parts.push(probe.message);
  console.log(parts.join("  "));
  if (probe.status === "ok" && probe.sampleFields?.length) {
    console.log(`          campos: ${probe.sampleFields.join(", ")}`);
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  if (!process.env.TIQUETAQUE_API_TOKEN) {
    console.error("TIQUETAQUE_API_TOKEN não configurada (defina no ambiente ou no .env do projeto).");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const explicit = args.filter((arg) => !arg.startsWith("--"));

  const announced = await discoverResources();
  if (!asJson) {
    if (announced) {
      console.log(`\nRecursos anunciados pelo documento raiz (${announced.length}):`);
      for (const resource of announced) {
        console.log(`  /${resource.name}${resource.title ? `  (${resource.title})` : ""}`);
      }
    } else {
      console.log("\nDocumento raiz não listou recursos — seguindo só por sondagem.");
    }
    console.log("\nSondagem (GET com max_results=1, ~1.1s entre chamadas pelo limite de 60 req/min):");
  }

  // Sonda o que a API anunciou E a lista de candidatos: um recurso pode
  // existir sem aparecer no documento raiz, e o inverso tambem acontece
  // (anunciado mas sem permissao pro nosso token).
  const toProbe =
    explicit.length > 0
      ? explicit
      : [...new Set([...(announced?.map((r) => r.name) ?? []), ...CANDIDATE_RESOURCES])].sort();

  const probes = await probeResources(toProbe, 1100, asJson ? undefined : printProbe);

  if (asJson) {
    console.log(JSON.stringify({ announced, probes }, null, 2));
    return;
  }

  const ok = probes.filter((p) => p.status === "ok");
  const writable = ok.filter((p) => p.allow?.some((verb) => ["POST", "PATCH", "PUT", "DELETE"].includes(verb)));
  console.log(`\nResumo: ${ok.length} de ${probes.length} recursos respondem.`);
  console.log(`Disponíveis: ${ok.map((p) => `/${p.resource}`).join(", ") || "nenhum"}`);
  console.log(`Aceitam escrita: ${writable.map((p) => `/${p.resource}`).join(", ") || "nenhum (ou não anunciam Allow)"}`);
  console.log(
    "\nPara cada recurso novo confirmado aqui, escreva o wrapper em src/lib/tiquetaque/resources.ts\n" +
      "e registre o achado em docs/tiquetaque-api.md.\n"
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
