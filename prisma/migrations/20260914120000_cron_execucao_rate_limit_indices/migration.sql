-- DropIndex
DROP INDEX "TimeClockEntry_driverId_date_idx";

-- CreateTable
CREATE TABLE "CronExecucao" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "iniciadoEm" TIMESTAMP(3) NOT NULL,
    "finalizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duracaoMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "processados" INTEGER NOT NULL DEFAULT 0,
    "continuacao" BOOLEAN NOT NULL DEFAULT false,
    "erros" JSONB,
    "detalhe" JSONB,

    CONSTRAINT "CronExecucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "chave" TEXT NOT NULL,
    "contagem" INTEGER NOT NULL,
    "reiniciaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE INDEX "CronExecucao_job_finalizadoEm_idx" ON "CronExecucao"("job", "finalizadoEm");

-- CreateIndex
CREATE INDEX "CronExecucao_finalizadoEm_idx" ON "CronExecucao"("finalizadoEm");

-- CreateIndex
CREATE INDEX "Escala_driverId_date_idx" ON "Escala"("driverId", "date");

-- CreateIndex
CREATE INDEX "Escala_vehicleId_date_idx" ON "Escala"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "Multa_companyId_dataLimiteIndicacao_idx" ON "Multa"("companyId", "dataLimiteIndicacao");

-- CreateIndex
CREATE INDEX "OrdemServico_companyId_atualizadaEm_idx" ON "OrdemServico"("companyId", "atualizadaEm");

-- CreateIndex
CREATE INDEX "TelemetryReading_companyId_recordedAt_idx" ON "TelemetryReading"("companyId", "recordedAt");

-- Guarda: se existir motorista+dia duplicado (importacoes concorrentes
-- antigas), move as correcoes pro registro mais recente e apaga os demais —
-- senao o indice unico abaixo falharia. Em 2026-09-14 nao havia duplicado.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "driverId", "date" ORDER BY "updatedAt" DESC, "createdAt" DESC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY "driverId", "date" ORDER BY "updatedAt" DESC, "createdAt" DESC) AS keep_id
  FROM "TimeClockEntry"
), dups AS (SELECT id, keep_id FROM ranked WHERE rn > 1)
UPDATE "TimeClockCorrection" c SET "entryId" = d.keep_id FROM dups d WHERE c."entryId" = d.id;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "driverId", "date" ORDER BY "updatedAt" DESC, "createdAt" DESC) AS rn
  FROM "TimeClockEntry"
), dups AS (SELECT id FROM ranked WHERE rn > 1)
DELETE FROM "TimeClockEntry" t USING dups d WHERE t.id = d.id;

-- CreateIndex
CREATE UNIQUE INDEX "TimeClockEntry_driverId_date_key" ON "TimeClockEntry"("driverId", "date");

-- CreateIndex
CREATE INDEX "VehicleTrip_vehicleId_startAt_idx" ON "VehicleTrip"("vehicleId", "startAt");

-- CreateIndex
CREATE INDEX "VehicleTrip_escalaId_idx" ON "VehicleTrip"("escalaId");

