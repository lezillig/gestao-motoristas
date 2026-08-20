-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "siatId" TEXT,
ADD COLUMN     "tipoContratacaoSiat" TEXT;

-- AlterTable
ALTER TABLE "Escala" ADD COLUMN     "boardingAddress" TEXT,
ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "departureTime" TEXT,
ADD COLUMN     "dropoffAddress" TEXT,
ADD COLUMN     "endDatetime" TIMESTAMP(3),
ADD COLUMN     "fonte" TEXT,
ADD COLUMN     "isAutoRelease" BOOLEAN,
ADD COLUMN     "routeName" TEXT,
ADD COLUMN     "scaleName" TEXT,
ADD COLUMN     "siatId" TEXT,
ADD COLUMN     "startDatetime" TIMESTAMP(3),
ADD COLUMN     "status" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "licensingMonth" TEXT,
ADD COLUMN     "ownership" TEXT,
ADD COLUMN     "siatId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Driver_siatId_key" ON "Driver"("siatId");

-- CreateIndex
CREATE UNIQUE INDEX "Escala_siatId_key" ON "Escala"("siatId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_siatId_key" ON "Vehicle"("siatId");
