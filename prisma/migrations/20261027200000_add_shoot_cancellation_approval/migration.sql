ALTER TABLE "ShootRequest" ADD COLUMN IF NOT EXISTS "cancellationRequested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShootRequest" ADD COLUMN IF NOT EXISTS "cancellationRequestedBy" TEXT;
ALTER TABLE "ShootRequest" ADD COLUMN IF NOT EXISTS "cancellationRequestedAt" TIMESTAMP(3);
ALTER TABLE "ShootRequest" ADD COLUMN IF NOT EXISTS "cancellationReviewNote" TEXT;