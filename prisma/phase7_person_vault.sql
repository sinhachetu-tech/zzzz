-- DropForeignKey
ALTER TABLE "ClientDocument" DROP CONSTRAINT "ClientDocument_caseId_fkey";

-- AlterTable
ALTER TABLE "CaseDocument" ADD COLUMN     "clientDocumentId" INTEGER;

-- AlterTable
ALTER TABLE "ClientDocument" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'KYC',
ADD COLUMN     "clientId" INTEGER NOT NULL,
ADD COLUMN     "compressedKey" TEXT,
ADD COLUMN     "compressedSize" INTEGER,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "driveFileId" TEXT,
ADD COLUMN     "expiryDate" TEXT,
ADD COLUMN     "fileData" BYTEA,
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rejectionReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "selectedVersion" TEXT NOT NULL DEFAULT 'original',
ADD COLUMN     "serviceLineId" INTEGER,
ADD COLUMN     "sharing" TEXT NOT NULL DEFAULT 'All',
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'vault',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'Pending upload',
ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "title" TEXT NOT NULL,
ADD COLUMN     "uploadedById" INTEGER,
ADD COLUMN     "uploadedByKind" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" INTEGER,
ALTER COLUMN "caseId" DROP NOT NULL,
ALTER COLUMN "fileName" DROP NOT NULL,
ALTER COLUMN "fileType" DROP NOT NULL,
ALTER COLUMN "fileSize" DROP NOT NULL,
ALTER COLUMN "uploadedAt" DROP NOT NULL,
ALTER COLUMN "uploadedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "ClientDocument_clientId_idx" ON "ClientDocument"("clientId");

-- CreateIndex
CREATE INDEX "ClientDocument_caseId_idx" ON "ClientDocument"("caseId");

-- CreateIndex
CREATE INDEX "ClientDocument_serviceLineId_idx" ON "ClientDocument"("serviceLineId");

-- CreateIndex
CREATE INDEX "ClientDocument_clientId_category_idx" ON "ClientDocument"("clientId", "category");

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_serviceLineId_fkey" FOREIGN KEY ("serviceLineId") REFERENCES "ServiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LoanCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_clientDocumentId_fkey" FOREIGN KEY ("clientDocumentId") REFERENCES "ClientDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

