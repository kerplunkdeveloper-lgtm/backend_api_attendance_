CREATE TABLE IF NOT EXISTS "LeaveChangeRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leaveRequestId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "oldStartDate" DATE NOT NULL,
  "oldEndDate" DATE NOT NULL,
  "newStartDate" DATE NOT NULL,
  "newEndDate" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedBy" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaveChangeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeaveChangeRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LeaveChangeRequest_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeaveChangeRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LeaveChangeRequest_organizationId_status_idx" ON "LeaveChangeRequest"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "LeaveChangeRequest_employeeId_status_idx" ON "LeaveChangeRequest"("employeeId", "status");
CREATE INDEX IF NOT EXISTS "LeaveChangeRequest_leaveRequestId_idx" ON "LeaveChangeRequest"("leaveRequestId");
