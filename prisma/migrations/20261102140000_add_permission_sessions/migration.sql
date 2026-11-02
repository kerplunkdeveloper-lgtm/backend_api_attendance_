ALTER TABLE "PermissionRequest"
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "startLatitude" DECIMAL(10,7),
  ADD COLUMN "startLongitude" DECIMAL(10,7),
  ADD COLUMN "endLatitude" DECIMAL(10,7),
  ADD COLUMN "endLongitude" DECIMAL(10,7),
  ADD COLUMN "startLocation" TEXT,
  ADD COLUMN "endLocation" TEXT;

CREATE INDEX "PermissionRequest_employeeId_status_date_idx"
  ON "PermissionRequest"("employeeId", "status", "date");
