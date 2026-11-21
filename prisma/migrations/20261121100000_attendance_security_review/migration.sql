-- Link HR device reviews to the day's attendance without deleting punch history.
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "securityReviewStatus" TEXT NOT NULL DEFAULT 'CLEAR';
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "securityReviewNote" TEXT;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "securityReviewedBy" TEXT;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "securityReviewedAt" TIMESTAMP(3);

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "attendanceId" TEXT;
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_attendanceId_idx" ON "AuditLog"("organizationId", "attendanceId");
