-- Company weekly off days (default Sunday). 0 = Sunday ... 6 = Saturday.
ALTER TABLE "AttendancePolicy" ADD COLUMN "weeklyOffDays" TEXT NOT NULL DEFAULT '0';
