-- Soft-deleted employees remain available for payroll/audit history, but their
-- employee codes must not block a new hire from using the released code.
DROP INDEX IF EXISTS "Employee_organizationId_employeeCode_key";

CREATE UNIQUE INDEX "Employee_organizationId_employeeCode_live_key"
  ON "Employee"("organizationId", "employeeCode")
  WHERE "deletedAt" IS NULL;
