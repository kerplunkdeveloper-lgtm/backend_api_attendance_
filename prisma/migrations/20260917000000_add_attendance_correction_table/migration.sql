-- Fresh databases need AttendanceCorrection before the hardening migration
-- creates its indexes. IF NOT EXISTS keeps this safe for environments where
-- the table was created by an earlier schema bootstrap.
CREATE TABLE IF NOT EXISTS "AttendanceCorrection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "date" DATE NOT NULL,
    "requestedCheckIn" TIMESTAMP(3),
    "requestedCheckOut" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AttendanceCorrection_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceCorrection_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceCorrection_attendanceId_fkey"
      FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AttendanceCorrection_organizationId_status_idx"
  ON "AttendanceCorrection"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "AttendanceCorrection_employeeId_idx"
  ON "AttendanceCorrection"("employeeId");
