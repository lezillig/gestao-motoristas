import { requireSession } from "@/lib/auth";
import { buildTemplateXlsx } from "@/lib/spreadsheet";

export async function GET() {
  await requireSession();

  const buffer = await buildTemplateXlsx({
    sheetName: "Combustível",
    headers: [
      "Data/Hora (AAAA-MM-DD HH:mm)",
      "Placa",
      "Motorista (CPF ou Nome)",
      "Valor (R$)",
      "Litros",
      "Combustível",
      "Posto",
      "Cidade",
      "UF",
      "Hodômetro (opcional)",
      "Nº Autorização (opcional)",
    ],
    example: [
      "2026-07-01 08:30",
      "ABC1D23",
      "12345678901",
      "350,00",
      "60,5",
      "Diesel S10",
      "Posto Exemplo",
      "São Paulo",
      "SP",
      "125430",
      "397380127",
    ],
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=modelo-combustivel.xlsx",
    },
  });
}
