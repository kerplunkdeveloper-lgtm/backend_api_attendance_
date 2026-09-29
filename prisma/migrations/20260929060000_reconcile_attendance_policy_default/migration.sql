-- Reconcile a harmless default that existed in Prisma schema but not in the
-- production database after older environments were synchronized with db push.
ALTER TABLE "AttendancePolicy"
  ALTER COLUMN "geofenceStrict" SET DEFAULT false;
