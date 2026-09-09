-- CreateEnum
CREATE TYPE "StatusIndicacaoCondutor" AS ENUM ('PENDENTE_MANUAL', 'SUGERIDA', 'ENVIADA', 'VALIDADA', 'REJEITADA');

-- CreateTable
CREATE TABLE "Multa" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "lwId" TEXT NOT NULL,
    "placaConsultada" TEXT NOT NULL,
    "ait" TEXT,
    "descricao" TEXT,
    "artigo" TEXT,
    "orgao" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "renavam" TEXT,
    "dataInfracao" TIMESTAMP(3),
    "horaInfracao" TEXT,
    "dataVencimento" TIMESTAMP(3),
    "dataLimiteIndicacao" TIMESTAMP(3),
    "valorCents" INTEGER,
    "pontuacao" INTEGER,
    "situacaoLw" TEXT,
    "statusPagamento" INTEGER,
    "pagoLw" BOOLEAN NOT NULL DEFAULT false,
    "rawJson" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Multa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndicacaoCondutor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "multaId" TEXT NOT NULL,
    "driverId" TEXT,
    "status" "StatusIndicacaoCondutor" NOT NULL DEFAULT 'PENDENTE_MANUAL',
    "origemResolucao" TEXT,
    "observacao" TEXT,
    "enviadaEm" TIMESTAMP(3),
    "validadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndicacaoCondutor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Multa_lwId_key" ON "Multa"("lwId");

-- CreateIndex
CREATE INDEX "Multa_companyId_dataInfracao_idx" ON "Multa"("companyId", "dataInfracao");

-- CreateIndex
CREATE INDEX "Multa_companyId_situacaoLw_idx" ON "Multa"("companyId", "situacaoLw");

-- CreateIndex
CREATE INDEX "Multa_vehicleId_idx" ON "Multa"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "IndicacaoCondutor_multaId_key" ON "IndicacaoCondutor"("multaId");

-- CreateIndex
CREATE INDEX "IndicacaoCondutor_companyId_status_idx" ON "IndicacaoCondutor"("companyId", "status");

-- CreateIndex
CREATE INDEX "IndicacaoCondutor_driverId_idx" ON "IndicacaoCondutor"("driverId");

-- AddForeignKey
ALTER TABLE "Multa" ADD CONSTRAINT "Multa_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Multa" ADD CONSTRAINT "Multa_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndicacaoCondutor" ADD CONSTRAINT "IndicacaoCondutor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndicacaoCondutor" ADD CONSTRAINT "IndicacaoCondutor_multaId_fkey" FOREIGN KEY ("multaId") REFERENCES "Multa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndicacaoCondutor" ADD CONSTRAINT "IndicacaoCondutor_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
