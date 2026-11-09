-- Track a completed but under-target workday separately from a half day.
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'SHORT_HOURS';
