-- Completed partial punches should be treated as short hours, not half-day.
-- Keep explicit half-day records without a short completed punch unchanged.
UPDATE "Attendance"
SET "status" = 'SHORT_HOURS'
WHERE "status" = 'HALF_DAY'
  AND "checkIn" IS NOT NULL
  AND "checkOut" IS NOT NULL
  AND "workingMinutes" > 0
  AND "workingMinutes" < 240;
