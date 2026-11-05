CREATE TABLE "OvertimeAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "approvedMinutes" INTEGER NOT NULL DEFAULT 0,
    "permissionMinutes" INTEGER NOT NULL DEFAULT 0,
    "leaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "compOffMinutes" INTEGER NOT NULL DEFAULT 0,
    "cashMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "employeeNote" TEXT,
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OvertimeAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OvertimeAllocation_employeeId_month_year_key" ON "OvertimeAllocation"("employeeId", "month", "year");
CREATE INDEX "OvertimeAllocation_organizationId_month_year_status_idx" ON "OvertimeAllocation"("organizationId", "month", "year", "status");
CREATE INDEX "OvertimeAllocation_employeeId_year_idx" ON "OvertimeAllocation"("employeeId", "year");

ALTER TABLE "OvertimeAllocation" ADD CONSTRAINT "OvertimeAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OvertimeAllocation" ADD CONSTRAINT "OvertimeAllocation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
