-- Requests to work on a day off (weekly off, holiday, company leave), approved by HR or an admin.
CREATE TABLE "DayOffWorkRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dayKind" TEXT NOT NULL,
    "reasonType" TEXT NOT NULL,
    "note" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayOffWorkRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DayOffWorkRequest_employeeId_date_key" ON "DayOffWorkRequest"("employeeId", "date");
CREATE INDEX "DayOffWorkRequest_organizationId_status_idx" ON "DayOffWorkRequest"("organizationId", "status");

ALTER TABLE "DayOffWorkRequest" ADD CONSTRAINT "DayOffWorkRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DayOffWorkRequest" ADD CONSTRAINT "DayOffWorkRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
