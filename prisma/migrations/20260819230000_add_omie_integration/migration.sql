-- CreateEnum
CREATE TYPE "OmieTipoLancamento" AS ENUM ('RECEBER', 'PAGAR');

-- CreateEnum
CREATE TYPE "OmieRecurso" AS ENUM ('CLIENTES', 'CONTAS_RECEBER', 'CONTAS_PAGAR');

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "cnpjCpf" TEXT,
ADD COLUMN     "omieCodigoCliente" TEXT,
ADD COLUMN     "omieNomeFantasia" TEXT,
ADD COLUMN     "omieRazaoSocial" TEXT,
ADD COLUMN     "omieSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OmieLancamento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" "OmieTipoLancamento" NOT NULL,
    "omieCodigoLancamento" TEXT NOT NULL,
    "clienteId" TEXT,
    "omieCodigoClienteFornecedor" TEXT,
    "nomeClienteFornecedor" TEXT,
    "cnpjCpfClienteFornecedor" TEXT,
    "numeroDocumento" TEXT,
    "codigoCategoria" TEXT,
    "codigoDepartamento" TEXT,
    "codigoProjeto" TEXT,
    "dataEmissao" TIMESTAMP(3),
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "dataPagamento" TIMESTAMP(3),
    "valorCents" INTEGER NOT NULL,
    "valorPagoCents" INTEGER,
    "status" TEXT,
    "observacao" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OmieLancamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OmieSyncLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recurso" "OmieRecurso" NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "executadoPorUserId" TEXT,
    "periodoInicio" TIMESTAMP(3),
    "periodoFim" TIMESTAMP(3),
    "criados" INTEGER NOT NULL DEFAULT 0,
    "atualizados" INTEGER NOT NULL DEFAULT 0,
    "ignorados" INTEGER NOT NULL DEFAULT 0,
    "paginasLidas" INTEGER NOT NULL DEFAULT 0,
    "interrompido" BOOLEAN NOT NULL DEFAULT false,
    "erro" TEXT,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "OmieSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OmieLancamento_companyId_dataVencimento_idx" ON "OmieLancamento"("companyId", "dataVencimento");

-- CreateIndex
CREATE INDEX "OmieLancamento_clienteId_dataVencimento_idx" ON "OmieLancamento"("clienteId", "dataVencimento");

-- CreateIndex
CREATE UNIQUE INDEX "OmieLancamento_companyId_tipo_omieCodigoLancamento_key" ON "OmieLancamento"("companyId", "tipo", "omieCodigoLancamento");

-- CreateIndex
CREATE INDEX "OmieSyncLog_companyId_iniciadoEm_idx" ON "OmieSyncLog"("companyId", "iniciadoEm");

-- CreateIndex
CREATE INDEX "Cliente_companyId_cnpjCpf_idx" ON "Cliente"("companyId", "cnpjCpf");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_companyId_omieCodigoCliente_key" ON "Cliente"("companyId", "omieCodigoCliente");

-- AddForeignKey
ALTER TABLE "OmieLancamento" ADD CONSTRAINT "OmieLancamento_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieLancamento" ADD CONSTRAINT "OmieLancamento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieSyncLog" ADD CONSTRAINT "OmieSyncLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OmieSyncLog" ADD CONSTRAINT "OmieSyncLog_executadoPorUserId_fkey" FOREIGN KEY ("executadoPorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

