-- AlterTable
ALTER TABLE "TimeClockCorrection" ADD COLUMN     "punchesAntes" JSONB,
ADD COLUMN     "punchesDepois" JSONB;

-- AlterTable
ALTER TABLE "TimeClockEntry" ADD COLUMN     "punches" JSONB;
