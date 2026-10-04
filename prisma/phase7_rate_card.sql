-- AlterTable
ALTER TABLE "LoanCase" ADD COLUMN     "bankProductId" INTEGER,
ADD COLUMN     "bookedBankProductId" INTEGER;

-- AddForeignKey
ALTER TABLE "LoanCase" ADD CONSTRAINT "LoanCase_bankProductId_fkey" FOREIGN KEY ("bankProductId") REFERENCES "BankProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanCase" ADD CONSTRAINT "LoanCase_bookedBankProductId_fkey" FOREIGN KEY ("bookedBankProductId") REFERENCES "BankProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

