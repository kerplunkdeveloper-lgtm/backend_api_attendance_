-- Keep the optional attendance link used by date-change reviews in sync with
-- the Prisma schema. Older deployments created LeaveChangeRequest without it.
ALTER TABLE "LeaveChangeRequest"
  ADD COLUMN IF NOT EXISTS "attendanceId" TEXT;
