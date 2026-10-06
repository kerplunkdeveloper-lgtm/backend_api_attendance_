-- Platform owner can suspend a workspace without deleting any data.
ALTER TABLE "Organization" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "suspendReason" TEXT;
