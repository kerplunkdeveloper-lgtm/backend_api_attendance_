-- Prisma schema fields queried on every login / punch that were never applied.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "taxId" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

ALTER TABLE "AttendancePolicy" ADD COLUMN IF NOT EXISTS "requireTrustedDevice" BOOLEAN NOT NULL DEFAULT false;
