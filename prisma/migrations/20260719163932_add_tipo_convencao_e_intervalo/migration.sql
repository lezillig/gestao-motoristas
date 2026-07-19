-- CreateEnum
CREATE TYPE "TipoConvencao" AS ENUM ('CCT', 'ACT');

-- AlterTable
ALTER TABLE "ConvencaoColetiva" ADD COLUMN     "tipo" "TipoConvencao" NOT NULL DEFAULT 'CCT';

-- AlterTable
ALTER TABLE "TimeClockEntry" ADD COLUMN     "intervaloFim" TEXT,
ADD COLUMN     "intervaloInicio" TEXT;
