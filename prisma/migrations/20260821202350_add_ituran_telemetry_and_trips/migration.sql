-- AlterTable
ALTER TABLE "TelemetryReading" ADD COLUMN     "odometerKm" DOUBLE PRECISION,
ADD COLUMN     "speedLimitKmh" INTEGER;

-- CreateTable
CREATE TABLE "VehicleTrip" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "iturarTripId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "maxSpeedKmh" INTEGER,
    "idleMinutes" INTEGER,
    "driverNameRaw" TEXT,
    "escalaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleTrip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleTrip_iturarTripId_key" ON "VehicleTrip"("iturarTripId");

-- CreateIndex
CREATE INDEX "VehicleTrip_companyId_startAt_idx" ON "VehicleTrip"("companyId", "startAt");

-- AddForeignKey
ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_escalaId_fkey" FOREIGN KEY ("escalaId") REFERENCES "Escala"("id") ON DELETE SET NULL ON UPDATE CASCADE;
