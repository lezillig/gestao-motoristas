-- AlterTable
ALTER TABLE "AnpPrecoReferencia" ADD COLUMN "municipio" TEXT NOT NULL DEFAULT '';

-- DropIndex (unique constraint being replaced by one that includes municipio)
DROP INDEX "AnpPrecoReferencia_uf_produto_semanaInicio_key";

-- CreateIndex
CREATE UNIQUE INDEX "AnpPrecoReferencia_uf_municipio_produto_semanaInicio_key" ON "AnpPrecoReferencia"("uf", "municipio", "produto", "semanaInicio");
