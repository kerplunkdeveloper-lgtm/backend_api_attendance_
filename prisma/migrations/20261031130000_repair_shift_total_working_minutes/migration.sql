-- Repair a partially-applied flexible-punching migration.
-- Keep this idempotent because some databases already have the column.
ALTER TABLE "Shift"
  ADD COLUMN IF NOT EXISTS "totalWorkingMinutes" INTEGER;
