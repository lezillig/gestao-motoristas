import { requireSession } from "@/lib/auth";
import { buildTemplateXlsx } from "@/lib/spreadsheet";

export async function GET() {
  await requireSession();

  const buffer = await buildTemplateXlsx({
    sheetName: "Veículos",
    headers: ["Placa", "Marca", "Modelo", "Ano", "Tipo", "Status"],
    example: ["ABC1D23", "Mercedes-Benz", "O500", "2020", "Ônibus", "Ativo"],
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=modelo-veiculos.xlsx",
    },
  });
}
