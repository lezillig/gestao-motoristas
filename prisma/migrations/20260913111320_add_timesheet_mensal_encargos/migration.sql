-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "encargosPercentual" INTEGER;

-- CreateTable
CREATE TABLE "TimesheetMensal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "mes" TEXT NOT NULL,
    "horasNormais" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "extra50" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "extra100" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adicionalNoturno" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "horaNoturnaReduzida" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dsr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "folga" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "atraso" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalHoras" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dias" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetMensal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimesheetMensal_companyId_mes_idx" ON "TimesheetMensal"("companyId", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetMensal_driverId_mes_key" ON "TimesheetMensal"("driverId", "mes");

-- AddForeignKey
ALTER TABLE "TimesheetMensal" ADD CONSTRAINT "TimesheetMensal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetMensal" ADD CONSTRAINT "TimesheetMensal_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
