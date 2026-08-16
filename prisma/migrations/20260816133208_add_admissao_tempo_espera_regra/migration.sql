-- AlterEnum
ALTER TYPE "TipoRegraConvencao" ADD VALUE 'TEMPO_ESPERA';

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "admissao" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TimeClockEntry" ADD COLUMN     "esperaFim" TEXT,
ADD COLUMN     "esperaInicio" TEXT;
