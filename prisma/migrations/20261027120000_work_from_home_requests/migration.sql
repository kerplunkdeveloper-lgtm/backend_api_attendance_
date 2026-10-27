CREATE TABLE "WorkFromHomeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkFromHomeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkFromHomeRequest_organizationId_status_idx" ON "WorkFromHomeRequest"("organizationId", "status");
CREATE INDEX "WorkFromHomeRequest_employeeId_startDate_endDate_idx" ON "WorkFromHomeRequest"("employeeId", "startDate", "endDate");
ALTER TABLE "WorkFromHomeRequest" ADD CONSTRAINT "WorkFromHomeRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkFromHomeRequest" ADD CONSTRAINT "WorkFromHomeRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;