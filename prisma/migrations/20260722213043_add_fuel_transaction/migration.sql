-- CreateTable
CREATE TABLE "FuelTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "dataHora" TIMESTAMP(3) NOT NULL,
    "valorCents" INTEGER NOT NULL,
    "volumeLitros" DOUBLE PRECISION NOT NULL,
    "combustivel" TEXT,
    "posto" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "hodometro" INTEGER,
    "numeroAutorizacao" TEXT,
    "placaOriginal" TEXT NOT NULL,
    "motoristaOriginal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuelTransaction_companyId_dataHora_idx" ON "FuelTransaction"("companyId", "dataHora");

-- CreateIndex
CREATE INDEX "FuelTransaction_vehicleId_dataHora_idx" ON "FuelTransaction"("vehicleId", "dataHora");

-- AddForeignKey
ALTER TABLE "FuelTransaction" ADD CONSTRAINT "FuelTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelTransaction" ADD CONSTRAINT "FuelTransaction_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelTransaction" ADD CONSTRAINT "FuelTransaction_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
