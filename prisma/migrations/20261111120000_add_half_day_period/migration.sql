CREATE TYPE "HalfDayPeriod" AS ENUM ('MORNING', 'AFTERNOON');

ALTER TABLE "LeaveRequest" ADD COLUMN "halfDayPeriod" "HalfDayPeriod";
