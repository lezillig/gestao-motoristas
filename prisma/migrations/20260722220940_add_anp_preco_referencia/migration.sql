-- CreateTable
CREATE TABLE "AnpPrecoReferencia" (
    "id" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "semanaInicio" TIMESTAMP(3) NOT NULL,
    "semanaFim" TIMESTAMP(3) NOT NULL,
    "precoMedioCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnpPrecoReferencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnpPrecoReferencia_semanaInicio_idx" ON "AnpPrecoReferencia"("semanaInicio");

-- CreateIndex
CREATE UNIQUE INDEX "AnpPrecoReferencia_uf_produto_semanaInicio_key" ON "AnpPrecoReferencia"("uf", "produto", "semanaInicio");
