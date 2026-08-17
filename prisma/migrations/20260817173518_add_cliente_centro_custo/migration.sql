-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "clienteId" TEXT;

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_companyId_nome_key" ON "Cliente"("companyId", "nome");

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
