-- CreateIndex
CREATE INDEX "Client_fullName_idx" ON "Client"("fullName");

-- CreateIndex
CREATE INDEX "LoanCase_customer_idx" ON "LoanCase"("customer");

-- CreateIndex
CREATE INDEX "LoanCase_serviceLineId_updatedAt_idx" ON "LoanCase"("serviceLineId", "updatedAt");

