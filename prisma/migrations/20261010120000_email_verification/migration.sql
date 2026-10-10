-- Signup email verification.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailVerificationCodeHash" TEXT,
  ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3);

-- Login now requires emailVerifiedAt to be set. Every account that already
-- exists predates this requirement and was never asked to verify, so it is
-- grandfathered in as verified at its original creation time — otherwise
-- every current user would be locked out the moment this ships.
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;
