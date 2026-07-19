import { requireSession } from "@/lib/auth";
import { buildTemplateXlsx } from "@/lib/spreadsheet";

export async function GET() {
  await requireSession();

  const buffer = await buildTemplateXlsx({
    sheetName: "Motoristas",
    headers: [
      "Nome",
      "CPF",
      "CNH",
      "Categoria CNH",
      "Validade CNH (AAAA-MM-DD)",
      "Telefone",
      "Sindicato",
      "Ativo (SIM/NAO)",
    ],
    example: [
      "João da Silva",
      "12345678901",
      "01234567890",
      "E",
      "2027-05-31",
      "(11) 98765-4321",
      "Sindicato dos Motoristas",
      "SIM",
    ],
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=modelo-motoristas.xlsx",
    },
  });
}
