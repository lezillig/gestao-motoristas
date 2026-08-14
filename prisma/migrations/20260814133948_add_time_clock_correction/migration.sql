-- CreateTable
CREATE TABLE "TimeClockCorrection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "clockInAntes" TEXT NOT NULL,
    "clockOutAntes" TEXT,
    "intervaloInicioAntes" TEXT,
    "intervaloFimAntes" TEXT,
    "clockInDepois" TEXT NOT NULL,
    "clockOutDepois" TEXT,
    "intervaloInicioDepois" TEXT,
    "intervaloFimDepois" TEXT,
    "corrigidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeClockCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeClockCorrection_companyId_corrigidoEm_idx" ON "TimeClockCorrection"("companyId", "corrigidoEm");

-- CreateIndex
CREATE INDEX "TimeClockCorrection_driverId_date_idx" ON "TimeClockCorrection"("driverId", "date");

-- AddForeignKey
ALTER TABLE "TimeClockCorrection" ADD CONSTRAINT "TimeClockCorrection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockCorrection" ADD CONSTRAINT "TimeClockCorrection_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockCorrection" ADD CONSTRAINT "TimeClockCorrection_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeClockEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
