-- CreateTable
CREATE TABLE "CompanyLeave" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "title" TEXT NOT NULL,
    "reason" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyLeave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyLeave_organizationId_startDate_endDate_idx" ON "CompanyLeave"("organizationId", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "CompanyLeave" ADD CONSTRAINT "CompanyLeave_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyLeave" ADD CONSTRAINT "CompanyLeave_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
