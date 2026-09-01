-- AlterTable
ALTER TABLE "FuelTransaction" ADD COLUMN     "desvioConsumoPercentual" DOUBLE PRECISION,
ADD COLUMN     "fonte" TEXT,
ADD COLUMN     "realConsumoKmL" DOUBLE PRECISION;
