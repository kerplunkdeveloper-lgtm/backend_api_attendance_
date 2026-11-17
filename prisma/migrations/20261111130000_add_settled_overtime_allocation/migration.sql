ALTER TABLE "OvertimeAllocation"
  ADD COLUMN "settledPermissionMinutes" INTEGER,
  ADD COLUMN "settledLeaveMinutes" INTEGER,
  ADD COLUMN "settledCompOffMinutes" INTEGER,
  ADD COLUMN "settledCashMinutes" INTEGER;

-- Existing approved choices already credited their selected entitlements.
-- Preserve those values while allowing later incremental claims.
UPDATE "OvertimeAllocation"
SET
  "settledPermissionMinutes" = "permissionMinutes",
  "settledLeaveMinutes" = "leaveMinutes",
  "settledCompOffMinutes" = "compOffMinutes",
  "settledCashMinutes" = "cashMinutes"
WHERE "status" = 'APPROVED';
