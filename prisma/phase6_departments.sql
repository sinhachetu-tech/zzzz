-- AlterTable
ALTER TABLE "Designation" ADD COLUMN     "serviceLineIds" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "ServiceLine" ADD COLUMN     "headUserId" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "serviceLineId" INTEGER;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_serviceLineId_fkey" FOREIGN KEY ("serviceLineId") REFERENCES "ServiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceLine" ADD CONSTRAINT "ServiceLine_headUserId_fkey" FOREIGN KEY ("headUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

