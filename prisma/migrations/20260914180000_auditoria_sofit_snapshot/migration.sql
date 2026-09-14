-- CreateTable
CREATE TABLE "AuditoriaSofitSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dia" TIMESTAMP(3) NOT NULL,
    "total" INTEGER NOT NULL,
    "alta" INTEGER NOT NULL,
    "media" INTEGER NOT NULL,
    "baixa" INTEGER NOT NULL,
    "porChave" JSONB NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditoriaSofitSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditoriaSofitSnapshot_companyId_dia_key" ON "AuditoriaSofitSnapshot"("companyId", "dia");

