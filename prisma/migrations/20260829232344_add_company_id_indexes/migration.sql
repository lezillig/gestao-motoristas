-- CreateIndex
CREATE INDEX "Driver_companyId_active_idx" ON "Driver"("companyId", "active");

-- CreateIndex
CREATE INDEX "Sindicato_companyId_idx" ON "Sindicato"("companyId");

-- CreateIndex
CREATE INDEX "Vehicle_companyId_idx" ON "Vehicle"("companyId");
