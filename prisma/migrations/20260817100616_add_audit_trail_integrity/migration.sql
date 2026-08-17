-- DropForeignKey
ALTER TABLE "TimeClockCorrection" DROP CONSTRAINT "TimeClockCorrection_entryId_fkey";

-- AlterTable
ALTER TABLE "TimeClockCorrection" ADD COLUMN     "editadoPorUserId" TEXT,
ADD COLUMN     "hashAntes" TEXT,
ADD COLUMN     "hashDepois" TEXT,
ADD COLUMN     "motivo" TEXT,
ADD COLUMN     "origem" TEXT NOT NULL DEFAULT 'TIQUETAQUE_REIMPORT',
ALTER COLUMN "entryId" DROP NOT NULL,
ALTER COLUMN "clockInDepois" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TimeClockEntry" ADD COLUMN     "hashAtual" TEXT;

-- AddForeignKey
ALTER TABLE "TimeClockCorrection" ADD CONSTRAINT "TimeClockCorrection_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeClockEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
