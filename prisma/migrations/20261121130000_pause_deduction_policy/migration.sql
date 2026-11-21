-- Configurable salary deductions for break/lunch time beyond the assigned shift allowance.
ALTER TABLE "AttendancePolicy"
  ADD COLUMN "breakDeductionEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lunchDeductionEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "breakGraceMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lunchGraceMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pauseDeductionSalaryBasis" TEXT NOT NULL DEFAULT 'BASE_SALARY',
  ADD COLUMN "breakDeductionMethod" TEXT NOT NULL DEFAULT 'HOURLY_RATE',
  ADD COLUMN "lunchDeductionMethod" TEXT NOT NULL DEFAULT 'HOURLY_RATE',
  ADD COLUMN "breakFixedPerMinute" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "lunchFixedPerMinute" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "maxPauseDeductionPerDay" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "Payslip"
  ADD COLUMN "breakDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "lunchDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pauseDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0;
