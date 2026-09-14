import ExcelJS from "exceljs";
import { format } from "date-fns";
import { requireRole } from "@/lib/auth";
import { auditarSofit } from "@/lib/sofit/auditoria";

const GRAV_LABEL = { alta: "Alta", media: "Média", baixa: "Baixa" } as const;

// Planilha da auditoria: aba "Resumo" + uma aba por achado (todas as linhas,
// nao so as 40 da tela) — e o que a equipe de manutencao recebe pra corrigir
// na Sofit. Nome de aba no Excel: max 31 chars, sem []:*?/\ .
function nomeAba(titulo: string, usados: Set<string>): string {
  let base = titulo.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28);
  let nome = base;
  let i = 2;
  while (usados.has(nome)) nome = `${base.slice(0, 25)} ${i++}`;
  usados.add(nome);
  base = nome;
  return base;
}

export async function GET() {
  const session = await requireRole("ADMIN", "GESTOR");
  const a = await auditarSofit(session.companyId);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Gestão de Motoristas";
  const resumo = wb.addWorksheet("Resumo");
  resumo.addRow(["Auditoria de dados da Sofit", format(a.geradoEm, "dd/MM/yyyy HH:mm")]);
  resumo.addRow([]);
  resumo.addRow(["Item", "Gravidade", "Apontamentos", "O que fazer"]);
  resumo.getRow(3).font = { bold: true };
  for (const ach of a.achados) resumo.addRow([ach.titulo, GRAV_LABEL[ach.gravidade], ach.linhas.length, ach.oQueFazer]);
  resumo.getColumn(1).width = 80;
  resumo.getColumn(2).width = 12;
  resumo.getColumn(3).width = 14;
  resumo.getColumn(4).width = 100;

  const usados = new Set<string>(["Resumo"]);
  for (const ach of a.achados) {
    const ws = wb.addWorksheet(nomeAba(ach.titulo, usados));
    ws.addRow([ach.titulo]);
    ws.getRow(1).font = { bold: true, size: 12 };
    ws.addRow([ach.oQueFazer]);
    ws.addRow([]);
    ws.addRow(ach.colunas);
    ws.getRow(4).font = { bold: true };
    for (const l of ach.linhas) ws.addRow(ach.colunas.map((c) => l[c] ?? ""));
    ach.colunas.forEach((c, i) => {
      const maior = Math.max(c.length, ...ach.linhas.slice(0, 200).map((l) => String(l[c] ?? "").length));
      ws.getColumn(i + 1).width = Math.min(60, Math.max(10, maior + 2));
    });
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=auditoria-sofit-${format(a.geradoEm, "yyyy-MM-dd")}.xlsx`,
    },
  });
}
