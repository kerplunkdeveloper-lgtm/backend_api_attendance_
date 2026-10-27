-- Planned off-site shoot requests. Approval is required before SHOOT punches.
CREATE TABLE "ShootRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shootName" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "note" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShootRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShootRequest_employeeId_date_key" ON "ShootRequest"("employeeId", "date");
CREATE INDEX "ShootRequest_organizationId_status_date_idx" ON "ShootRequest"("organizationId", "status", "date");
CREATE INDEX "ShootRequest_employeeId_date_idx" ON "ShootRequest"("employeeId", "date");
ALTER TABLE "ShootRequest" ADD CONSTRAINT "ShootRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShootRequest" ADD CONSTRAINT "ShootRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;