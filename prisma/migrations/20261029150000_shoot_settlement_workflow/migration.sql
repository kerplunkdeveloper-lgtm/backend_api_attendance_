ALTER TABLE "AttendancePolicy"
  ADD COLUMN IF NOT EXISTS "shootRecoveryEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "shootRecoveryThresholdMinutes" INTEGER NOT NULL DEFAULT 720,
  ADD COLUMN IF NOT EXISTS "shootTravelOtEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "shootOtMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS "shootOtSalaryBasis" TEXT NOT NULL DEFAULT 'BASE_SALARY';

CREATE TABLE IF NOT EXISTS "ShootSettlement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "shootRequestId" TEXT NOT NULL,
  "attendanceId" TEXT,
  "shootDate" DATE NOT NULL,
  "shootStart" TIMESTAMP(3),
  "shootEnd" TIMESTAMP(3),
  "travelStart" TIMESTAMP(3),
  "travelEnd" TIMESTAMP(3),
  "returnedNextDay" BOOLEAN NOT NULL DEFAULT false,
  "shootMinutes" INTEGER NOT NULL DEFAULT 0,
  "travelMinutes" INTEGER NOT NULL DEFAULT 0,
  "shootOvertimeMinutes" INTEGER NOT NULL DEFAULT 0,
  "travelOvertimeMinutes" INTEGER NOT NULL DEFAULT 0,
  "totalDutyMinutes" INTEGER NOT NULL DEFAULT 0,
  "recoveryLeaveEligible" BOOLEAN NOT NULL DEFAULT false,
  "recoveryLeaveRequested" BOOLEAN NOT NULL DEFAULT false,
  "recoveryLeaveStatus" "RequestStatus",
  "recoveryLeaveDate" DATE,
  "allowances" JSONB,
  "expenses" JSONB,
  "employeeNote" TEXT,
  "hrNote" TEXT,
  "approvedShootMinutes" INTEGER,
  "approvedShootOtMinutes" INTEGER,
  "approvedTravelOtMinutes" INTEGER,
  "approvedAllowanceAmount" DECIMAL(10,2),
  "approvedExpenseAmount" DECIMAL(10,2),
  "overtimePay" DECIMAL(10,2),
  "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
  "payrollStatus" TEXT NOT NULL DEFAULT 'NOT_READY',
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShootSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShootSettlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShootSettlement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShootSettlement_shootRequestId_fkey" FOREIGN KEY ("shootRequestId") REFERENCES "ShootRequest"("id") ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShootSettlement_employeeId_shootRequestId_key" ON "ShootSettlement"("employeeId", "shootRequestId");
CREATE INDEX IF NOT EXISTS "ShootSettlement_organizationId_status_idx" ON "ShootSettlement"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "ShootSettlement_employeeId_shootDate_idx" ON "ShootSettlement"("employeeId", "shootDate");
CREATE INDEX IF NOT EXISTS "ShootSettlement_payrollStatus_idx" ON "ShootSettlement"("payrollStatus");
