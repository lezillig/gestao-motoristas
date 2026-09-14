-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "manutencaoIntervaloDias" INTEGER,
ADD COLUMN     "manutencaoIntervaloKm" INTEGER,
ADD COLUMN     "sofitDisponibilidade" TEXT,
ADD COLUMN     "sofitId" TEXT,
ADD COLUMN     "sofitOdometroKm" INTEGER,
ADD COLUMN     "sofitStatus" TEXT,
ADD COLUMN     "sofitSyncedAt" TIMESTAMP(3),
ADD COLUMN     "ultimaManutencaoEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrdemServico" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "sofitId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "placaOriginal" TEXT,
    "tipo" TEXT,
    "status" TEXT,
    "origem" TEXT,
    "motivo" TEXT,
    "problema" TEXT,
    "fornecedor" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,
    "inicioEm" TIMESTAMP(3),
    "fimEm" TIMESTAMP(3),
    "previsaoFimEm" TIMESTAMP(3),
    "diasParado" DOUBLE PRECISION,
    "hodometroFinal" INTEGER,
    "custoCents" INTEGER,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrdemServico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VencimentoVeiculo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "sofitDueId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "categoria" TEXT,
    "venceEm" TIMESTAMP(3) NOT NULL,
    "recorrente" BOOLEAN NOT NULL DEFAULT false,
    "recorrencia" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VencimentoVeiculo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrdemServico_sofitId_key" ON "OrdemServico"("sofitId");

-- CreateIndex
CREATE INDEX "OrdemServico_companyId_status_idx" ON "OrdemServico"("companyId", "status");

-- CreateIndex
CREATE INDEX "OrdemServico_companyId_criadaEm_idx" ON "OrdemServico"("companyId", "criadaEm");

-- CreateIndex
CREATE INDEX "OrdemServico_vehicleId_fimEm_idx" ON "OrdemServico"("vehicleId", "fimEm");

-- CreateIndex
CREATE UNIQUE INDEX "VencimentoVeiculo_sofitDueId_key" ON "VencimentoVeiculo"("sofitDueId");

-- CreateIndex
CREATE INDEX "VencimentoVeiculo_companyId_venceEm_idx" ON "VencimentoVeiculo"("companyId", "venceEm");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_sofitId_key" ON "Vehicle"("sofitId");

-- AddForeignKey
ALTER TABLE "OrdemServico" ADD CONSTRAINT "OrdemServico_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdemServico" ADD CONSTRAINT "OrdemServico_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VencimentoVeiculo" ADD CONSTRAINT "VencimentoVeiculo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VencimentoVeiculo" ADD CONSTRAINT "VencimentoVeiculo_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

