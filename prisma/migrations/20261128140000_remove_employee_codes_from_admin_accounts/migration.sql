-- Account owners are not workforce employees and must not consume employee IDs.
ALTER TABLE "Employee" ALTER COLUMN "employeeCode" DROP NOT NULL;

UPDATE "Employee" AS employee
SET "employeeCode" = NULL
FROM "User" AS account
WHERE employee."userId" = account."id"
  AND account."role" IN ('COMPANY_ADMIN', 'SUPER_ADMIN');
