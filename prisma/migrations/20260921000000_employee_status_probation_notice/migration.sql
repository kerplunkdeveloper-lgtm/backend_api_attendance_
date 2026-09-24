-- Recreate enum so PROBATION and NOTICE_PERIOD can be added in one migration.
CREATE TYPE "EmployeeStatus_new" AS ENUM ('ACTIVE', 'INACTIVE', 'TERMINATED', 'PROBATION', 'NOTICE_PERIOD');
ALTER TABLE "Employee" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Employee" ALTER COLUMN "status" TYPE "EmployeeStatus_new" USING ("status"::text::"EmployeeStatus_new");
ALTER TYPE "EmployeeStatus" RENAME TO "EmployeeStatus_old";
ALTER TYPE "EmployeeStatus_new" RENAME TO "EmployeeStatus";
ALTER TABLE "Employee" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
DROP TYPE "EmployeeStatus_old";
