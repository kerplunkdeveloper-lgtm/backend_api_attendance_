ALTER TABLE "ShootSettlement"
  ADD COLUMN IF NOT EXISTS "shootOvertimeStatus" "RequestStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "shootOvertimeReviewNote" TEXT,
  ADD COLUMN IF NOT EXISTS "shootOvertimeReviewedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "shootOvertimeReviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "travelOvertimeStatus" "RequestStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "travelOvertimeReviewNote" TEXT,
  ADD COLUMN IF NOT EXISTS "travelOvertimeReviewedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "travelOvertimeReviewedAt" TIMESTAMP(3);

UPDATE "ShootSettlement"
SET
  "shootOvertimeStatus" = CASE WHEN COALESCE("shootOvertimeMinutes", 0) = 0 THEN 'APPROVED'::"RequestStatus" ELSE COALESCE("overtimeStatus", 'PENDING'::"RequestStatus") END,
  "travelOvertimeStatus" = CASE WHEN COALESCE("travelOvertimeMinutes", 0) = 0 THEN 'APPROVED'::"RequestStatus" ELSE COALESCE("overtimeStatus", 'PENDING'::"RequestStatus") END;
