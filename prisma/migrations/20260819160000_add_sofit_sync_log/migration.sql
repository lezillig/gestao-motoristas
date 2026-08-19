-- CreateTable
CREATE TABLE "SofitSyncLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "periodoInicio" TIMESTAMP(3),
    "periodoFim" TIMESTAMP(3),
    "lidos" INTEGER NOT NULL DEFAULT 0,
    "criados" INTEGER NOT NULL DEFAULT 0,
    "atualizados" INTEGER NOT NULL DEFAULT 0,
    "ignorados" INTEGER NOT NULL DEFAULT 0,
    "sucesso" BOOLEAN NOT NULL DEFAULT true,
    "mensagens" JSONB,
    "duracaoMs" INTEGER,
    "executadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SofitSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SofitSyncLog_companyId_entidade_createdAt_idx" ON "SofitSyncLog"("companyId", "entidade", "createdAt");

-- AddForeignKey
ALTER TABLE "SofitSyncLog" ADD CONSTRAINT "SofitSyncLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
