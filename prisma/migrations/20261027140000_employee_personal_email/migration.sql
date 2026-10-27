-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "personalEmail" TEXT;

-- CreateIndex
CREATE INDEX "Employee_personalEmail_idx" ON "Employee"("personalEmail");
