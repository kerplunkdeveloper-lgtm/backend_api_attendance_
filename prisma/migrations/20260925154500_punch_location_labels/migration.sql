-- Human-readable punch places so the team can see where each person clocked in.
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "checkInLocation" TEXT;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "checkOutLocation" TEXT;
