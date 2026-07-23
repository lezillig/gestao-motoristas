-- AlterTable
ALTER TABLE "FuelTransaction" ADD COLUMN "kmRodados" INTEGER;
ALTER TABLE "FuelTransaction" ADD COLUMN "codigoTransacao" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FuelTransaction_codigoTransacao_key" ON "FuelTransaction"("codigoTransacao");
