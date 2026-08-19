-- AlterTable
ALTER TABLE "TelemetryReading" ADD COLUMN     "address" TEXT,
ADD COLUMN     "ignition" BOOLEAN,
ADD COLUMN     "odometerKm" INTEGER;

-- Remove leituras duplicadas antes de criar o indice unico. Duplicata aqui e
-- a mesma posicao (mesmo veiculo, mesmo instante, mesmo fornecedor) gravada
-- mais de uma vez; mantem a linha de menor id e descarta o resto.
DELETE FROM "TelemetryReading" a
USING "TelemetryReading" b
WHERE a."vehicleId" = b."vehicleId"
  AND a."recordedAt" = b."recordedAt"
  AND a."provider" = b."provider"
  AND a."id" > b."id";

-- CreateIndex
CREATE UNIQUE INDEX "TelemetryReading_vehicleId_recordedAt_provider_key" ON "TelemetryReading"("vehicleId", "recordedAt", "provider");
