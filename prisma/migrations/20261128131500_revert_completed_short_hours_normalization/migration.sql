-- Roll back the completed partial-punch normalization from the previous migration.
UPDATE "Attendance"
SET "status" = 'HALF_DAY'
WHERE "status" = 'SHORT_HOURS'
  AND "checkIn" IS NOT NULL
  AND "checkOut" IS NOT NULL
  AND "workingMinutes" > 0
  AND "workingMinutes" < 240;
