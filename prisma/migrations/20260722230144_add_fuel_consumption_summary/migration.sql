-- CreateTable
CREATE TABLE "FuelConsumptionSummary" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "placaOriginal" TEXT NOT NULL,
    "contrato" TEXT NOT NULL,
    "tipoCombustivel" TEXT NOT NULL,
    "periodoInicio" TIMESTAMP(3) NOT NULL,
    "periodoFim" TIMESTAMP(3) NOT NULL,
    "kmRodados" INTEGER,
    "horasTrabalhadas" DOUBLE PRECISION,
    "litros" DOUBLE PRECISION NOT NULL,
    "valorMedioLitroCents" INTEGER,
    "kmPorLitro" DOUBLE PRECISION,
    "litrosPorHora" DOUBLE PRECISION,
    "totalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelConsumptionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuelConsumptionSummary_companyId_periodoInicio_idx" ON "FuelConsumptionSummary"("companyId", "periodoInicio");

-- CreateIndex
CREATE UNIQUE INDEX "FuelConsumptionSummary_companyId_placaOriginal_contrato_tip_key" ON "FuelConsumptionSummary"("companyId", "placaOriginal", "contrato", "tipoCombustivel", "periodoInicio", "periodoFim");

-- AddForeignKey
ALTER TABLE "FuelConsumptionSummary" ADD CONSTRAINT "FuelConsumptionSummary_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelConsumptionSummary" ADD CONSTRAINT "FuelConsumptionSummary_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
