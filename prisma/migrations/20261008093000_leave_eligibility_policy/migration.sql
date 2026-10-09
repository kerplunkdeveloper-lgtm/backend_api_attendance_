ALTER TABLE "AttendancePolicy"
  ADD COLUMN "probationMonths" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "monthlyPermissionHours" DECIMAL(4,1) NOT NULL DEFAULT 3.0,
  ADD COLUMN "permissionRequiresProbation" BOOLEAN NOT NULL DEFAULT true;
