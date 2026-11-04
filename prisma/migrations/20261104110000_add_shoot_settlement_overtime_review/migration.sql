ALTER TABLE "ShootSettlement"
  ADD COLUMN IF NOT EXISTS "overtimeStatus" "RequestStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "overtimeReviewNote" TEXT,
  ADD COLUMN IF NOT EXISTS "overtimeReviewedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "overtimeReviewedAt" TIMESTAMP(3);

-- Settlements with no overtime claim do not need a separate HR decision.
UPDATE "ShootSettlement"
SET "overtimeStatus" = 'APPROVED'
WHERE COALESCE("shootOvertimeMinutes", 0) + COALESCE("travelOvertimeMinutes", 0) = 0;
