-- CreateTable
CREATE TABLE "DriverLeave" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "tiquetaqueId" TEXT,
    "leaveType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "details" TEXT,
    "paidLeave" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverLeave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverLeave_tiquetaqueId_key" ON "DriverLeave"("tiquetaqueId");

-- CreateIndex
CREATE INDEX "DriverLeave_companyId_startDate_idx" ON "DriverLeave"("companyId", "startDate");

-- CreateIndex
CREATE INDEX "DriverLeave_driverId_startDate_idx" ON "DriverLeave"("driverId", "startDate");

-- AddForeignKey
ALTER TABLE "DriverLeave" ADD CONSTRAINT "DriverLeave_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLeave" ADD CONSTRAINT "DriverLeave_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
