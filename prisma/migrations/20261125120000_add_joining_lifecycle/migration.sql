ALTER TYPE "OnboardingStatus" ADD VALUE IF NOT EXISTS 'PRE_JOINING';
ALTER TYPE "OnboardingStatus" ADD VALUE IF NOT EXISTS 'JOINING_RESCHEDULED';
ALTER TYPE "OnboardingStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';

ALTER TABLE "OnboardingCandidate"
  ADD COLUMN "actualJoiningDate" DATE,
  ADD COLUMN "joiningConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "joiningConfirmedBy" TEXT,
  ADD COLUMN "joiningRescheduledFrom" DATE,
  ADD COLUMN "joiningRescheduleReason" TEXT,
  ADD COLUMN "noShowAt" TIMESTAMP(3),
  ADD COLUMN "noShowReason" TEXT,
  ADD COLUMN "reminder7SentAt" TIMESTAMP(3),
  ADD COLUMN "reminder2SentAt" TIMESTAMP(3),
  ADD COLUMN "joiningDayReminderAt" TIMESTAMP(3);

CREATE INDEX "OnboardingCandidate_organizationId_expectedJoinDate_status_idx"
  ON "OnboardingCandidate"("organizationId", "expectedJoinDate", "status");
