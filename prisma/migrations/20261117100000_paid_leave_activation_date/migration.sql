-- Existing employees are activated in the new monthly paid-leave policy now.
-- Their dateOfJoining remains the historical HR date and must not make old
-- leave requests consume the WorkPulse monthly allowance.
ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "paidLeaveStartDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The default above backfills all existing rows at migration time. Keep the
-- default for employees added after this migration so their earning starts in
-- the month they are added to WorkPulse.

-- Reconcile balances already imported from the previous HR tool. Only
-- approved requests from the WorkPulse activation window should consume the
-- paid balance going forward; historical leave remains in LeaveRequest for
-- audit/history but does not reduce the new policy allowance.
UPDATE "LeaveBalance" lb
SET "usedDays" = COALESCE((
  SELECT SUM(lr."totalDays")
  FROM "LeaveRequest" lr
  JOIN "Employee" e ON e.id = lb."employeeId"
  WHERE lr."employeeId" = lb."employeeId"
    AND lr."leaveTypeId" = lb."leaveTypeId"
    AND lr.status = 'APPROVED'
    AND EXTRACT(YEAR FROM lr."startDate") = lb.year
    AND lr."startDate" >= e."paidLeaveStartDate"
), 0)
WHERE EXISTS (
  SELECT 1
  FROM "LeaveType" lt
  WHERE lt.id = lb."leaveTypeId" AND lt."isPaid" = true
);
