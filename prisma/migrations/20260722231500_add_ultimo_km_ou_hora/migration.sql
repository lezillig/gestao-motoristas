-- AlterTable
ALTER TABLE "FuelConsumptionSummary" ADD COLUMN "ultimoKmOuHora" DOUBLE PRECISION;

-- DropIndex
DROP INDEX "FuelConsumptionSummary_companyId_placaOriginal_contrato_tip_key";

-- CreateIndex
CREATE UNIQUE INDEX "FuelConsumptionSummary_companyId_placaOriginal_contrato_tip_key" ON "FuelConsumptionSummary"("companyId", "placaOriginal", "contrato", "tipoCombustivel", "periodoInicio", "periodoFim", "ultimoKmOuHora");
