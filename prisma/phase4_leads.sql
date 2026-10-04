-- DropForeignKey
ALTER TABLE "ClientSession" DROP CONSTRAINT "ClientSession_caseId_fkey";

-- AlterTable
ALTER TABLE "ClientSession" ALTER COLUMN "caseId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ClientSession" ADD CONSTRAINT "ClientSession_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LoanCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

