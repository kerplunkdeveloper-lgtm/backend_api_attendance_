-- Admin who gave the final decision on a resignation, separate from the HR reviewer
ALTER TABLE "EmployeeExit" ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3);
