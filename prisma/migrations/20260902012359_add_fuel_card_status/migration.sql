-- CreateTable
CREATE TABLE "FuelCardStatus" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "numeroCartao" TEXT NOT NULL,
    "placaOriginal" TEXT NOT NULL,
    "situacaoCartao" TEXT,
    "situacaoVeiculo" TEXT,
    "saldoCents" INTEGER,
    "limiteCents" INTEGER,
    "saldoLitros" DOUBLE PRECISION,
    "limiteLitros" DOUBLE PRECISION,
    "comprasPeriodoCents" INTEGER,
    "comprasPeriodoLitros" DOUBLE PRECISION,
    "tipoCombustivelPadrao" TEXT,
    "tipoFrota" TEXT,
    "modeloVeiculo" TEXT,
    "fabricanteVeiculo" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "nomeResponsavel" TEXT,
    "dataAtivacao" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuelCardStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuelCardStatus_companyId_vehicleId_idx" ON "FuelCardStatus"("companyId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "FuelCardStatus_companyId_numeroCartao_key" ON "FuelCardStatus"("companyId", "numeroCartao");

-- AddForeignKey
ALTER TABLE "FuelCardStatus" ADD CONSTRAINT "FuelCardStatus_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelCardStatus" ADD CONSTRAINT "FuelCardStatus_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
