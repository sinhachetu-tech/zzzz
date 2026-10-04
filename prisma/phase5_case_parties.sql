-- CreateTable
CREATE TABLE "CaseParty" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CoBorrower',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseParty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseParty_clientId_idx" ON "CaseParty"("clientId");

-- CreateIndex
CREATE INDEX "CaseParty_caseId_sortOrder_idx" ON "CaseParty"("caseId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CaseParty_caseId_clientId_key" ON "CaseParty"("caseId", "clientId");

-- AddForeignKey
ALTER TABLE "CaseParty" ADD CONSTRAINT "CaseParty_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LoanCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseParty" ADD CONSTRAINT "CaseParty_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

