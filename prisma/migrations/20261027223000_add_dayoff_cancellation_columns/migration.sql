ALTER TABLE "DayOffWorkRequest"
  ADD COLUMN IF NOT EXISTS "cancellationRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cancellationRequestedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellationRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellationReviewNote" TEXT;