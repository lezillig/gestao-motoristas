-- DropForeignKey
ALTER TABLE "Escala" DROP CONSTRAINT "Escala_vehicleId_fkey";

-- AlterTable
ALTER TABLE "Escala" ALTER COLUMN "vehicleId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Escala" ADD CONSTRAINT "Escala_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
