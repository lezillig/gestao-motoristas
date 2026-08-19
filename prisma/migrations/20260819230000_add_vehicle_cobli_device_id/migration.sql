-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "cobliDeviceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_cobliDeviceId_key" ON "Vehicle"("cobliDeviceId");
