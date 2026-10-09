-- Payroll cycle and day basis per organization
ALTER TABLE "AttendancePolicy"
  ADD COLUMN "payrollCycleStartDay" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "payrollCycleEndDay" INTEGER NOT NULL DEFAULT 31,
  ADD COLUMN "payrollDayBasis" TEXT NOT NULL DEFAULT 'ACTUAL_DAYS';

-- Payslip period and permission deduction
ALTER TABLE "Payslip"
  ADD COLUMN "periodStart" DATE,
  ADD COLUMN "periodEnd" DATE,
  ADD COLUMN "permissionDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PermissionRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DECIMAL(4,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PermissionRequest_organizationId_status_date_idx" ON "PermissionRequest"("organizationId", "status", "date");
CREATE INDEX "PermissionRequest_employeeId_date_idx" ON "PermissionRequest"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "PermissionRequest" ADD CONSTRAINT "PermissionRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PermissionRequest" ADD CONSTRAINT "PermissionRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
