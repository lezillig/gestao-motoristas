-- CreateEnum
CREATE TYPE "RegimeHoras" AS ENUM ('PADRAO', 'DOZE_X_TRINTA_SEIS');

-- CreateEnum
CREATE TYPE "EscalaSemanal" AS ENUM ('SEIS_UM', 'CINCO_DOIS');

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "escalaSemanal" "EscalaSemanal",
ADD COLUMN     "regimeHoras" "RegimeHoras";
